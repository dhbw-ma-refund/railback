#!/usr/bin/env python3
"""RailBack READ-PATH load test — runs against ALREADY-EXISTING data.

Read-only. Creates nothing, deletes nothing. Isolates each documented admin
read pattern (see ../../../railback-schema-docs/03_query_patterns.typ §2a) and
ramps concurrency to find which access pattern throttles the DynamoDB table
first and at what point.

Patterns exercised (one at a time, in isolation):
  Query / GetItem (expected cheap):
    - GET /admin/tickets/{id}                     T1  GetItem
    - GET /admin/users/{email}                    U3  GetItem
    - GET /admin/tickets?trainNr=&date=           Route 1  Query gsi1
    - GET /admin/tickets?email=                   Route 2  Query base
  Scan / N+1 (expected expensive):
    - GET /admin/tickets?state=                   Route 3  Scan
    - GET /admin/tickets  (no filter)             Route 3  Scan
    - GET /admin/stats                            double full-table Scan (30s cache)
    - GET /admin/users?limit=                     Query gsi1 + N+1 tickets.adminList/row
    - GET /admin/users?email=<prefix>             Query gsi1 begins_with + N+1

For each pattern it ramps --levels concurrency, firing a fixed request count per
level, and records error rate, RPS, and latency percentiles. Real keys are
sampled from existing rows at startup (no hardcoded IDs).

Usage:
  uv run python loadtests/read_path.py \
      --base https://<lambda-url>.lambda-url.eu-north-1.on.aws \
      --admin-email admin@railback.de --admin-password '<pw>' \
      --levels 1,5,10,20,40 --requests-per-level 60 \
      --out /Users/<you>/Documents/railback-schema-docs

TLS note: this environment's stdlib CA store may be broken. If you see
CERTIFICATE_VERIFY_FAILED, run with SSL_CERT_FILE=$(python -m certifi).
"""
from __future__ import annotations

import argparse
import json
import os
import ssl
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone


def _ssl_context() -> ssl.SSLContext:
    # Prefer an explicit bundle; fall back to certifi if the system store is broken.
    if os.environ.get("SSL_CERT_FILE"):
        return ssl.create_default_context()
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _load_dotenv() -> None:
    # Minimal .env reader: KEY=VALUE lines -> os.environ (never overrides an
    # already-set var). Checks CWD, CWD/.., and the bundle root (relative to
    # this file), so it works whether you run from python/ or the bundle root.
    import pathlib
    here = pathlib.Path(__file__).resolve()
    candidates = [
        pathlib.Path.cwd() / ".env",
        pathlib.Path.cwd().parent / ".env",
        here.parent.parent.parent / ".env",
    ]
    for p in candidates:
        try:
            if not p.is_file():
                continue
            for line in p.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        except Exception:
            continue


class Http:
    def __init__(self, base: str, timeout: float = 15.0):
        self.base = base.rstrip("/")
        self.timeout = timeout
        self._ctx = _ssl_context()

    def get(self, path: str, token: str) -> tuple[int, float, bytes]:
        req = urllib.request.Request(
            self.base + path, headers={"Authorization": "Bearer " + token})
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as r:
                body = r.read()
                return r.status, (time.perf_counter() - t0) * 1000, body
        except urllib.error.HTTPError as e:
            return e.code, (time.perf_counter() - t0) * 1000, e.read()
        except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
            return 0, (time.perf_counter() - t0) * 1000, str(e).encode()

    def post(self, path: str, token: str, body: dict) -> tuple[int, float, bytes]:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            self.base + path, data=data, method="POST",
            headers={"Authorization": "Bearer " + token,
                     "Content-Type": "application/json"})
        t0 = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as r:
                return r.status, (time.perf_counter() - t0) * 1000, r.read()
        except urllib.error.HTTPError as e:
            return e.code, (time.perf_counter() - t0) * 1000, e.read()
        except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
            return 0, (time.perf_counter() - t0) * 1000, str(e).encode()

    def login(self, email: str, password: str) -> str:
        data = json.dumps({"email": email, "password": password}).encode()
        req = urllib.request.Request(
            self.base + "/auth/login", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout, context=self._ctx) as r:
            return json.loads(r.read())["accessToken"]


def _pct(a: list[float], p: float) -> float:
    if not a:
        return 0.0
    s = sorted(a)
    return round(s[min(len(s) - 1, int(p / 100 * len(s)))], 1)


def sample_keys(http: Http, token: str, user_token: str) -> dict:
    """Pull real keys from existing data so probes hit live rows."""
    status, _, body = http.get("/admin/tickets?limit=100", token)
    items = (json.loads(body) or {}).get("items", []) if status == 200 else []
    if not items:
        raise SystemExit("no existing tickets to read — cannot run read-path test")
    first = items[0]
    tid = first["ticketId"]
    email = first["email"]
    # get one ticket detail for a real trainNr + date (Route 1 keys)
    st, _, db = http.get(f"/admin/tickets/{tid}", token)
    detail = json.loads(db) if st == 200 else {}
    train = detail.get("fahrt_zugnummer_plan") or detail.get("trainNr") or "ICE 1000"
    date = detail.get("fahrt_abreisedatum") or detail.get("date") or "2026-06-20"
    states = sorted({t.get("ticket_state", "READY") for t in items})

    # USER-side: the seeded user's own email + one of their ticket ids.
    ust, _, ub = http.get("/users/me", user_token)
    user_email = (json.loads(ub) or {}).get("email", "") if ust == 200 else ""
    utst, _, utb = http.get("/users/me/tickets", user_token)
    uitems = (json.loads(utb) or {}).get("items", []) if utst == 200 else []
    user_tid = uitems[0]["ticketId"] if uitems else tid

    # Delay data (real, discovered via route-lookup): a popular route with segments.
    # Verified live: Frankfurt (Main) Hbf -> Stuttgart Hbf @ 2026-06-20, train ICE2845.
    route_lookup = {"fromStation": "Frankfurt (Main) Hbf", "toStation": "Stuttgart Hbf",
                    "date": "2026-06-20", "abfahrtszeit_plan": "08:00"}
    delay_train, delay_date = "ICE2845", "2026-06-20"
    # Confirm the route still resolves; if so, adopt its first candidate's trainNr.
    rst, _, rb = http.post("/users/me/tickets/route-lookup", user_token, route_lookup)
    if rst == 200:
        cands = (json.loads(rb) or {}).get("candidates", [])
        if cands and cands[0].get("trainNr"):
            delay_train = cands[0]["trainNr"]

    return {"ticketId": tid, "email": email, "trainNr": train, "date": date,
            "states": states, "state": states[0] if states else "READY",
            "userEmail": user_email, "userTicketId": user_tid,
            "delayTrain": delay_train, "delayDate": delay_date,
            "routeLookup": route_lookup}


def patterns(k: dict) -> dict:
    # Each entry: (token_kind, method, path, body). token_kind ∈ {"admin","user"}.
    from urllib.parse import quote
    e = quote(k["email"]); tr = quote(k["trainNr"]); st = quote(k["state"])
    dtr = quote(k["delayTrain"]); dd = k["delayDate"]
    rl = k["routeLookup"]  # {fromStation,toStation,date,abfahrtszeit_plan}
    return {
        # --- ADMIN cheap: Query / GetItem ---
        "GET_ticket_by_id__GetItem": ("admin", "GET", f"/admin/tickets/{k['ticketId']}", None),
        "GET_user_by_email__GetItem": ("admin", "GET", f"/admin/users/{e}", None),
        "tickets_trainNr_date__Query_gsi1": ("admin", "GET", f"/admin/tickets?trainNr={tr}&date={k['date']}&limit=50", None),
        "tickets_trainNr_date_lim100__Query_gsi1": ("admin", "GET", f"/admin/tickets?trainNr={tr}&date={k['date']}&limit=100", None),
        "tickets_email__Query_base": ("admin", "GET", f"/admin/tickets?email={e}&limit=50", None),
        "tickets_email_lim100__Query_base": ("admin", "GET", f"/admin/tickets?email={e}&limit=100", None),
        # --- ADMIN expensive: Scan (Route 3 variants) ---
        "tickets_state__Scan_base": ("admin", "GET", f"/admin/tickets?state={st}&limit=50", None),
        "tickets_state_lim100__Scan_base": ("admin", "GET", f"/admin/tickets?state={st}&limit=100", None),
        "tickets_daterange__Scan_base": ("admin", "GET", "/admin/tickets?from=2026-06-01&to=2026-06-30&limit=50", None),
        "tickets_nofilter__Scan_base": ("admin", "GET", "/admin/tickets?limit=50", None),
        "tickets_nofilter_lim100__Scan_base": ("admin", "GET", "/admin/tickets?limit=100", None),
        "stats__double_Scan": ("admin", "GET", "/admin/stats", None),
        # --- ADMIN expensive: users list = Query gsi1 + N+1 tickets.adminList per row ---
        "users_list__Query_plus_Nplus1": ("admin", "GET", "/admin/users?limit=50", None),
        "users_list_lim100__Query_plus_Nplus1": ("admin", "GET", "/admin/users?limit=100", None),
        "users_prefix__Query_plus_Nplus1": ("admin", "GET", "/admin/users?email=loadtest-&limit=50", None),
        "users_state_filter__Query_plus_Nplus1": ("admin", "GET", "/admin/users?user_state=ACTIVE&limit=50", None),
        # --- ADMIN: delays passthrough — Query pk=TRAIN#<nr>#<date>, begins_with(sk,"SEG#") (V2) ---
        "admin_train_delays__Query_TRAIN": ("admin", "GET", f"/admin/trains/{dtr}/{dd}/delays", None),
        # --- ADMIN: pending SEPA batches — Scan on mandate fields (M3) [empty-set] ---
        "admin_pending_batches__Scan_mandate": ("admin", "GET", "/admin/sepa/pending-batches", None),
        # --- USER-scoped reads (USER token) ---
        "me_profile__GetItem": ("user", "GET", "/users/me", None),
        "me_refund_data__GetItem_plus_decrypt": ("user", "GET", "/users/me/refund-data", None),
        "me_tickets__Query_base": ("user", "GET", "/users/me/tickets", None),
        "me_ticket_by_id__GetItem": ("user", "GET", f"/users/me/tickets/{k['userTicketId']}", None),
        "me_route_templates__Query_base": ("user", "GET", "/users/me/route-templates", None),
        # --- USER: stateless route-lookup — GSI3 STATION#<eva>#<date> Query (V3) ---
        "me_route_lookup__Query_gsi3": ("user", "POST", "/users/me/tickets/route-lookup", rl),
    }


def run_level(http: Http, token: str, method: str, path: str, body: dict | None, conc: int, total: int) -> dict:
    lat: list[float] = []
    codes: dict = {}
    err = 0
    sample = ""
    launched = 0
    lock = __import__("threading").Lock()

    def worker():
        nonlocal launched, err, sample
        while True:
            with lock:
                if launched >= total:
                    return
                launched += 1
            if method == "POST":
                status, ms, resp_body = http.post(path, token, body or {})
            else:
                status, ms, resp_body = http.get(path, token)
            with lock:
                lat.append(ms)
                key = str(status) if status else "NETERR"
                codes[key] = codes.get(key, 0) + 1
                if not (200 <= status < 300):
                    err += 1
                    if not sample and resp_body:
                        sample = resp_body[:160].decode("utf-8", "replace")

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=conc) as ex:
        for _ in range(conc):
            ex.submit(worker)
    secs = time.perf_counter() - t0
    n = len(lat)
    return {
        "concurrency": conc, "n": n, "errors": err,
        "error_rate_pct": round(err / n * 100, 1) if n else 0,
        "rps": round(n / secs, 1) if secs else 0,
        "avg_ms": round(sum(lat) / n, 1) if n else 0,
        "p95_ms": _pct(lat, 95), "p99_ms": _pct(lat, 99),
        "max_ms": round(max(lat), 1) if lat else 0,
        "codes": codes, "err_sample": sample,
    }


def render_md(results: dict, meta: dict) -> str:
    lines = ["# RailBack — Read-Path Results (existing data)", "",
             f"- Target: `{meta['base']}`",
             f"- Run: {meta['ts']}",
             f"- Sampled keys: trainNr=`{meta['keys']['trainNr']}` "
             f"date=`{meta['keys']['date']}` states=`{','.join(meta['keys']['states'])}`",
             f"- Levels: {meta['levels']}, requests/level: {meta['rpl']}", "",
             "Read-only. No data created or deleted.", ""]
    for name, rows in results.items():
        lines += [f"## {name}", "",
                  "| conc | rps | err% | avg ms | p95 ms | p99 ms | codes |",
                  "|---|---|---|---|---|---|---|"]
        for r in rows:
            lines.append(f"| {r['concurrency']} | {r['rps']} | {r['error_rate_pct']} | "
                         f"{r['avg_ms']} | {r['p95_ms']} | {r['p99_ms']} | "
                         f"`{json.dumps(r['codes'])}` |")
        lines.append("")
    return "\n".join(lines)


def main():
    _load_dotenv()
    ap = argparse.ArgumentParser(description="RailBack read-path load test (read-only)")
    ap.add_argument("--base", default=os.environ.get("RAILBACK_API_BASE", ""),
                    help="live API base URL; default from RAILBACK_API_BASE in .env")
    ap.add_argument("--admin-email", default=os.environ.get("RAILBACK_ADMIN_EMAIL", ""),
                    help="default from RAILBACK_ADMIN_EMAIL in .env")
    ap.add_argument("--admin-password", default=os.environ.get("RAILBACK_ADMIN_PASSWORD", ""),
                    help="default from RAILBACK_ADMIN_PASSWORD in .env")
    ap.add_argument("--user-email", default="", help="seeded USER for user-scoped reads; auto-picked from loadtest- prefix if omitted")
    ap.add_argument("--user-password", default=os.environ.get("RAILBACK_USER_PASSWORD", "min-8-zeichen"))
    ap.add_argument("--levels", default="1,5,10,20,40")
    ap.add_argument("--requests-per-level", type=int, default=60)
    ap.add_argument("--settle-ms", type=int, default=1500)
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--out", default=".")
    ap.add_argument("--log", default="", help="append per-level progress here as the run proceeds (tail -f); default <out>/read_path_<ts>.log")
    args = ap.parse_args()
    if not (args.base and args.admin_email and args.admin_password):
        raise SystemExit("missing base/admin creds: set --base/--admin-email/--admin-password "
                         "or RAILBACK_API_BASE/RAILBACK_ADMIN_EMAIL/RAILBACK_ADMIN_PASSWORD in .env")
    http = Http(args.base, timeout=args.timeout)
    os.makedirs(args.out, exist_ok=True)
    _run_ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    _log_path = args.log or os.path.join(args.out, f"read_path_{_run_ts}.log")
    _logf = open(_log_path, "a", buffering=1)  # line-buffered → tail -f shows progress live

    def _log(s: str) -> None:
        print(s)
        _logf.write(s + "\n")
        _logf.flush()

    _log(f"[start] {datetime.now(timezone.utc).isoformat()} base={args.base} "
         f"levels={args.levels} rpl={args.requests_per_level} timeout={args.timeout}s")
    token = http.login(args.admin_email, args.admin_password)
    print("[auth] admin token acquired")
    # A seeded user shares the load-test password; pick one for the USER-scoped reads.
    user_email = args.user_email
    if not user_email:
        # Page through seeded loadtest- users and pick the first that actually
        # owns tickets, so the USER-scoped ticket read hits a row it owns.
        st, _, ub = http.get("/admin/users?email=loadtest-&limit=50", token)
        cand = (json.loads(ub) or {}).get("items", []) if st == 200 else []
        for u in cand:
            em = u.get("email", "")
            if not em:
                continue
            try:
                utok_probe = http.login(em, args.user_password)
            except Exception:
                continue
            _, _, tb = http.get("/users/me/tickets", utok_probe)
            if (json.loads(tb) or {}).get("items", []):
                user_email = em
                break
        if not user_email and cand:
            user_email = cand[0].get("email", "")
    if not user_email:
        raise SystemExit("no seeded loadtest- user found; pass --user-email")
    user_token = http.login(user_email, args.user_password)
    print(f"[auth] user token acquired ({user_email})")
    keys = sample_keys(http, token, user_token)
    print(f"[keys] {keys}")
    levels = [int(x) for x in args.levels.split(",") if x]
    pats = patterns(keys)
    tokens = {"admin": token, "user": user_token}

    results: dict = {}
    for name, (tok_kind, method, path, body) in pats.items():
        results[name] = []
        _log(f"\n### {name}\n    [{tok_kind}] {method} {path}")
        for conc in levels:
            row = run_level(http, tokens[tok_kind], method, path, body, conc, args.requests_per_level)
            results[name].append(row)
            _log(f"    c={conc:>2}  err={row['error_rate_pct']:>5}%  "
                 f"rps={row['rps']:>6}  avg={row['avg_ms']:>7}ms  "
                 f"p99={row['p99_ms']:>7}ms  codes={json.dumps(row['codes'])}"
                 + (f"  ex:{row['err_sample']}" if row['err_sample'] else ""))
            time.sleep(args.settle_ms / 1000)
        # refresh both tokens between patterns (900s TTL)
        token = http.login(args.admin_email, args.admin_password)
        user_token = http.login(user_email, args.user_password)
        tokens = {"admin": token, "user": user_token}

    os.makedirs(args.out, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    meta = {"base": args.base, "ts": ts, "keys": keys,
            "levels": args.levels, "rpl": args.requests_per_level}
    jpath = os.path.join(args.out, f"read_path_{ts}.json")
    mpath = os.path.join(args.out, f"read_path_{ts}.md")
    with open(jpath, "w") as f:
        json.dump({"meta": meta, "results": results}, f, indent=2)
    with open(mpath, "w") as f:
        f.write(render_md(results, meta))
    print(f"\n[report] {jpath}\n[report] {mpath}")


if __name__ == "__main__":
    main()
