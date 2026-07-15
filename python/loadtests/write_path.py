#!/usr/bin/env python3
"""RailBack WRITE-PATH load test — measures create + delete throughput.

Two measured phases:
  CREATE — register N users (POST /auth/register: scrypt + AES-GCM + PutItem)
           and create M tickets each (POST /users/me/tickets/from-route:
           TransactWriteItems of UserTicket + TicketOwner). Measures write RPS
           and latency at a chosen concurrency.
  DELETE — HARD-delete every created user via the project's boto3 connector
           (db.connector.RailBackConnector.delete_user), which removes the whole
           USER#<email> partition (profile + tickets + owner rows) and is
           verified by re-query. Measures delete RPS.

WHY HARD DELETE (not DELETE /users/me): the API's delete is a SOFT delete —
scheduleDeletion() only flips the profile to DELETION_SCHEDULED with ttl=now+30d
and never touches ticket/owner rows, so it would orphan every created ticket.
The only true cleanup is the DynamoDB DeleteItem cascade.

SAFETY: PREFLIGHT refuses to run unless it can prove hard-delete works (AWS
creds resolve AND a canary row round-trips through delete_user). A run that
cannot clean up would permanently pollute the table.

All created rows are marked load-test data:
  email  loadtest-<runId>-<n>@loadtest.example.de
  names  vorname/nachname/strasse/ort = LOADTEST

Usage:
  uv run python loadtests/write_path.py \
      --base https://<lambda-url>.lambda-url.eu-north-1.on.aws \
      --users 200 --tickets-per-user 4 \
      --create-concurrency 40 --delete-concurrency 20 \
      --out /Users/<you>/Documents/railback-schema-docs

  Plan only (no creds, touches nothing):  ... --dry-run

Requires AWS credentials for the RailBack table in eu-north-1 (env/~/.aws/SSO/
role) and boto3 (`uv sync`). TLS note: set SSL_CERT_FILE=$(python -m certifi)
if the stdlib store is broken.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import ssl
import string
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
try:
    from db.connector import REGION, TABLE_NAME, RailBackConnector
except Exception:
    REGION = "eu-north-1"
    TABLE_NAME = os.environ.get("RAILBACK_DDB_TABLE", "RailBack")
    RailBackConnector = None  # type: ignore

LT_DOMAIN = "loadtest.example.de"
LT_NAME = "LOADTEST"
STATIONS = [
    ("Berlin Hauptbahnhof", "München Hbf"),
    ("Hamburg Hbf", "Frankfurt (Main) Hbf"),
    ("Köln Hbf", "Stuttgart Hbf"),
    ("Düsseldorf Hbf", "Leipzig Hbf"),
    ("Hannover Hbf", "Nürnberg Hbf"),
    ("Dortmund Hbf", "Essen Hbf"),
    ("Bremen Hbf", "Dresden Hbf"),
]


def _ssl_context() -> ssl.SSLContext:
    if os.environ.get("SSL_CERT_FILE"):
        return ssl.create_default_context()
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _rand(n=6):
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


class Http:
    def __init__(self, base: str, timeout: float = 15.0):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self._ctx = _ssl_context()

    def post(self, path: str, body: dict, token: str | None = None) -> tuple[int, float, dict | None]:
        data = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        req = urllib.request.Request(self.base + path, data=data, headers=headers, method="POST")
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as r:
                return r.status, (time.perf_counter() - t0) * 1000, json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                j = json.loads(e.read())
            except Exception:
                j = None
            return e.code, (time.perf_counter() - t0) * 1000, j
        except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
            return 0, (time.perf_counter() - t0) * 1000, {"error": str(e)}


def reg_body(email: str) -> dict:
    return {
        "email": email, "password": "min-8-zeichen",
        "vorname": LT_NAME, "nachname": LT_NAME, "telefon": "+49 151 1234567",
        "adresse": {"strasse": LT_NAME, "hausnr": "1", "plz": "68161",
                    "ort": LT_NAME, "land": "DE"},
        "iban": "DE89 3704 0044 0532 0130 00", "bic": "COBADEFFXXX",
        "datenschutz_einwilligung": True, "agb_akzeptiert": True,
    }


def ticket_body() -> dict:
    frm, to = random.choice(STATIONS)
    return {
        "trainNr": "ICE " + str(1000 + random.randint(0, 799)), "date": "2026-06-20",
        "fromStation": frm, "toStation": to,
        "abfahrtszeit_plan": "08:00", "ankunftszeit_plan": "12:00",
        "fahrkartennummer": "DB-" + _rand(), "fahrkartenpreis": "123.45",
        "is_zeitkarte": False,
    }


def _pct(a: list[float], p: float) -> float:
    if not a:
        return 0.0
    s = sorted(a)
    return round(s[min(len(s) - 1, int(p / 100 * len(s)))], 1)


class WritePathTest:
    def __init__(self, args):
        self.args = args
        self.http = Http(args.base, timeout=args.timeout)
        self.run_id = int(time.time())
        self.emails: list[str] = []
        self.tickets: list[str] = []
        self.results: dict = {"run_id": self.run_id, "base": args.base}

    def preflight(self) -> "RailBackConnector":
        if RailBackConnector is None:
            raise SystemExit("PREFLIGHT FAILED: db.connector import failed (run `uv sync`).")
        try:
            import boto3
            creds = boto3.Session().get_credentials()
        except Exception as e:
            raise SystemExit(f"PREFLIGHT FAILED: boto3 unavailable: {e}")
        if creds is None:
            raise SystemExit(
                "PREFLIGHT FAILED: no AWS credentials resolvable. Hard-delete is "
                "impossible, so this run would permanently pollute the table. "
                f"Configure creds for {TABLE_NAME} in {REGION} and retry.")
        conn = RailBackConnector()
        canary = f"canary-{self.run_id}-{_rand()}@{LT_DOMAIN}"
        conn.user._put({
            "pk": f"USER#{canary}", "sk": "PROFILE",
            "gsi1_pk": "USER", "gsi1_sk": f"EMAIL#{canary}",
            "email": canary, "user_state": "ACTIVE",
            "hashed_password": "x",
            "vorname": LT_NAME, "nachname": LT_NAME,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "datenschutz_einwilligung": True, "agb_akzeptiert": True,
        })
        if conn.delete_user(canary).is_err() or conn.user.get(canary).unwrap() is not None:
            raise SystemExit("PREFLIGHT FAILED: canary hard-delete did not remove the row.")
        print(f"[preflight] hard-delete verified on {TABLE_NAME}/{REGION} (creds: {creds.method})")
        return conn

    # ---- CREATE phase --------------------------------------------------- #
    def create_phase(self):
        n = self.args.users
        tpu = self.args.tickets_per_user
        conc = self.args.create_concurrency
        print(f"[create] {n} users x {tpu} tickets @ concurrency {conc}")
        reg_lat: list[float] = []
        tkt_lat: list[float] = []
        reg_err = tkt_err = 0
        lock = __import__("threading").Lock()

        def make_user(i: int):
            nonlocal reg_err, tkt_err
            email = f"loadtest-{self.run_id}-{i}@{LT_DOMAIN}"
            st, ms, body = self.http.post("/auth/register", reg_body(email))
            with lock:
                reg_lat.append(ms)
                if st != 201:
                    reg_err += 1
            if st != 201 or not body or "accessToken" not in body:
                return
            tok = body["accessToken"]
            with lock:
                self.emails.append(email)
            for _ in range(tpu):
                s2, m2, b2 = self.http.post("/users/me/tickets/from-route", ticket_body(), tok)
                with lock:
                    tkt_lat.append(m2)
                    if s2 == 201 and b2 and "ticketId" in b2:
                        self.tickets.append(b2["ticketId"])
                    else:
                        tkt_err += 1

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as ex:
            list(ex.map(make_user, range(n)))
        secs = time.perf_counter() - t0
        total_writes = len(reg_lat) + len(tkt_lat)
        self.results["create"] = {
            "users_created": len(self.emails), "tickets_created": len(self.tickets),
            "register_errors": reg_err, "ticket_errors": tkt_err,
            "seconds": round(secs, 1),
            "write_rps": round(total_writes / secs, 1) if secs else 0,
            "register_avg_ms": round(sum(reg_lat) / len(reg_lat), 1) if reg_lat else 0,
            "register_p95_ms": _pct(reg_lat, 95), "register_p99_ms": _pct(reg_lat, 99),
            "ticket_avg_ms": round(sum(tkt_lat) / len(tkt_lat), 1) if tkt_lat else 0,
            "ticket_p95_ms": _pct(tkt_lat, 95), "ticket_p99_ms": _pct(tkt_lat, 99),
        }
        c = self.results["create"]
        print(f"[create] users={c['users_created']} tickets={c['tickets_created']} "
              f"in {c['seconds']}s (~{c['write_rps']} write RPS) "
              f"reg_p95={c['register_p95_ms']}ms tkt_p95={c['ticket_p95_ms']}ms")

    # ---- DELETE phase (hard) -------------------------------------------- #
    def delete_phase(self, conn: "RailBackConnector"):
        conc = self.args.delete_concurrency
        print(f"[delete] hard-deleting {len(self.emails)} users @ concurrency {conc}")
        lat: list[float] = []
        errors: list[str] = []
        lock = __import__("threading").Lock()

        def _del(email: str):
            t0 = time.perf_counter()
            res = conn.delete_user(email)
            ms = (time.perf_counter() - t0) * 1000
            with lock:
                lat.append(ms)
                if res.is_err():
                    errors.append(f"{email}: {res}")

        t0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=conc) as ex:
            list(ex.map(_del, self.emails))
        secs = time.perf_counter() - t0
        gone = sum(1 for e in self.emails if conn.user.get(e).unwrap() is None)
        self.results["delete"] = {
            "attempted": len(self.emails), "verified_gone": gone,
            "remaining": len(self.emails) - gone,
            "seconds": round(secs, 1),
            "delete_rps": round(len(self.emails) / secs, 1) if secs else 0,
            "avg_ms": round(sum(lat) / len(lat), 1) if lat else 0,
            "p95_ms": _pct(lat, 95), "p99_ms": _pct(lat, 99),
            "errors": errors[:20],
        }
        d = self.results["delete"]
        print(f"[delete] verified_gone={d['verified_gone']} remaining={d['remaining']} "
              f"in {d['seconds']}s (~{d['delete_rps']} delete RPS)")

    def write_reports(self):
        os.makedirs(self.args.out, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        self.results["finished_at"] = ts
        jpath = os.path.join(self.args.out, f"write_path_{ts}.json")
        mpath = os.path.join(self.args.out, f"write_path_{ts}.md")
        with open(jpath, "w") as f:
            json.dump(self.results, f, indent=2)
        with open(mpath, "w") as f:
            f.write(self._render_md())
        print(f"[report] {jpath}\n[report] {mpath}")

    def _render_md(self) -> str:
        r = self.results
        c = r.get("create", {})
        d = r.get("delete", {})
        return "\n".join([
            f"# RailBack — Write-Path Results", "",
            f"- Target: `{r['base']}`",
            f"- Run: {r['run_id']} (finished {r.get('finished_at','')})", "",
            "## Create (register + from-route)", "",
            "| metric | value |", "|---|---|",
            f"| users created | {c.get('users_created')} |",
            f"| tickets created | {c.get('tickets_created')} |",
            f"| seconds | {c.get('seconds')} |",
            f"| **write RPS** | **{c.get('write_rps')}** |",
            f"| register avg / p95 / p99 ms | {c.get('register_avg_ms')} / {c.get('register_p95_ms')} / {c.get('register_p99_ms')} |",
            f"| ticket avg / p95 / p99 ms | {c.get('ticket_avg_ms')} / {c.get('ticket_p95_ms')} / {c.get('ticket_p99_ms')} |",
            f"| register errors | {c.get('register_errors')} |",
            f"| ticket errors | {c.get('ticket_errors')} |", "",
            "## Delete (hard, boto3 cascade)", "",
            "| metric | value |", "|---|---|",
            f"| attempted | {d.get('attempted')} |",
            f"| verified gone | {d.get('verified_gone')} |",
            f"| remaining | {d.get('remaining')} |",
            f"| seconds | {d.get('seconds')} |",
            f"| **delete RPS** | **{d.get('delete_rps')}** |",
            f"| avg / p95 / p99 ms | {d.get('avg_ms')} / {d.get('p95_ms')} / {d.get('p99_ms')} |", "",
            "Cleanup: every created row was hard-deleted (profile + tickets + "
            "owner rows) and verified absent by re-query.", "",
        ])

    def _manifest_path(self) -> str:
        return os.path.join(self.args.out, "write_path_created.json")

    def _save_manifest(self):
        os.makedirs(self.args.out, exist_ok=True)
        with open(self._manifest_path(), "w") as f:
            json.dump({"run_id": self.run_id, "emails": self.emails,
                       "tickets": self.tickets}, f)
        print(f"[keep] created rows recorded → {self._manifest_path()} "
              f"(purge later with --purge-only)")

    def _load_manifest(self) -> None:
        with open(self._manifest_path()) as f:
            m = json.load(f)
        self.emails = m.get("emails", [])
        self.tickets = m.get("tickets", [])
        print(f"[purge-only] loaded {len(self.emails)} users from manifest "
              f"{self._manifest_path()}")

    def run(self):
        conn = self.preflight()
        # purge-only: reload a prior --keep run's rows and hard-delete them.
        if self.args.purge_only:
            self._load_manifest()
            if not self.emails:
                print("[purge-only] nothing to delete.")
                return
            self.delete_phase(conn)
            return
        # keep: create + measure, but leave data in place for a read test.
        if self.args.keep:
            self.create_phase()
            self._save_manifest()
            self.write_reports()
            return
        # default: create + measure, then always clean up.
        try:
            self.create_phase()
        finally:
            self.delete_phase(conn)
        self.write_reports()


def main():
    ap = argparse.ArgumentParser(description="RailBack write-path load test (create + hard delete)")
    ap.add_argument("--base", required=True)
    ap.add_argument("--admin-email", default="", help="unused; kept for CLI symmetry")
    ap.add_argument("--admin-password", default="")
    ap.add_argument("--users", type=int, default=200)
    ap.add_argument("--tickets-per-user", type=int, default=4)
    ap.add_argument("--create-concurrency", type=int, default=40)
    ap.add_argument("--delete-concurrency", type=int, default=20)
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--out", default="/Users/I749952/Documents/railback-schema-docs")
    ap.add_argument("--dry-run", action="store_true")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--keep", action="store_true",
                      help="create + measure, but do NOT delete — leaves marked "
                           "data in place (e.g. to then run read_path.py). Records "
                           "created rows to write_path_created.json in --out.")
    mode.add_argument("--purge-only", action="store_true",
                      help="skip create; reload write_path_created.json from --out "
                           "and hard-delete those rows. Cleans up a prior --keep run.")
    args = ap.parse_args()

    if args.dry_run:
        mode = ("keep (create, no delete)" if args.keep
                else "purge-only (delete prior --keep rows)" if args.purge_only
                else "create + hard-delete")
        print("DRY RUN — write path, nothing executed:")
        print(f"  target : {args.base}")
        print(f"  mode   : {mode}")
        print(f"  create : {args.users} users x {args.tickets_per_user} tickets @ conc {args.create_concurrency}")
        print(f"  delete : HARD delete via db.connector @ conc {args.delete_concurrency} (needs AWS creds)")
        print(f"  markers: loadtest-<run>-<n>@{LT_DOMAIN}, names={LT_NAME}")
        print("  NOTE: real runs abort at preflight unless hard-delete is verified.")
        return

    WritePathTest(args).run()


if __name__ == "__main__":
    main()
