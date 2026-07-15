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


def sample_keys(http: Http, token: str) -> dict:
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
    return {"ticketId": tid, "email": email, "trainNr": train, "date": date,
            "states": states, "state": states[0] if states else "READY"}


def patterns(k: dict) -> dict:
    from urllib.parse import quote
    e = quote(k["email"]); tr = quote(k["trainNr"]); st = quote(k["state"])
    return {
        # cheap: Query / GetItem
        "GET_ticket_by_id__GetItem": f"/admin/tickets/{k['ticketId']}",
        "GET_user_by_email__GetItem": f"/admin/users/{e}",
        "tickets_trainNr_date__Query_gsi1": f"/admin/tickets?trainNr={tr}&date={k['date']}&limit=50",
        "tickets_email__Query_base": f"/admin/tickets?email={e}&limit=50",
        # expensive: Scan / N+1
        "tickets_state__Scan_base": f"/admin/tickets?state={st}&limit=50",
        "tickets_nofilter__Scan_base": "/admin/tickets?limit=50",
        "stats__double_Scan": "/admin/stats",
        "users_list__Query_plus_Nplus1": "/admin/users?limit=50",
        "users_prefix__Query_plus_Nplus1": "/admin/users?email=loadtest-&limit=50",
    }


def run_level(http: Http, token: str, path: str, conc: int, total: int) -> dict:
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
            status, ms, body = http.get(path, token)
            with lock:
                lat.append(ms)
                key = str(status) if status else "NETERR"
                codes[key] = codes.get(key, 0) + 1
                if not (200 <= status < 300):
                    err += 1
                    if not sample and body:
                        sample = body[:160].decode("utf-8", "replace")

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
    ap = argparse.ArgumentParser(description="RailBack read-path load test (read-only)")
    ap.add_argument("--base", required=True)
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--levels", default="1,5,10,20,40")
    ap.add_argument("--requests-per-level", type=int, default=60)
    ap.add_argument("--settle-ms", type=int, default=1500)
    ap.add_argument("--timeout", type=float, default=15.0)
    ap.add_argument("--out", default="/Users/I749952/Documents/railback-schema-docs")
    args = ap.parse_args()

    http = Http(args.base, timeout=args.timeout)
    token = http.login(args.admin_email, args.admin_password)
    print(f"[auth] admin token acquired")
    keys = sample_keys(http, token)
    print(f"[keys] {keys}")
    levels = [int(x) for x in args.levels.split(",") if x]
    pats = patterns(keys)

    results: dict = {}
    for name, path in pats.items():
        results[name] = []
        print(f"\n### {name}\n    {path}")
        for conc in levels:
            # token TTL is 900s; refresh defensively every pattern
            row = run_level(http, token, path, conc, args.requests_per_level)
            results[name].append(row)
            print(f"    c={conc:>2}  err={row['error_rate_pct']:>5}%  "
                  f"rps={row['rps']:>6}  avg={row['avg_ms']:>7}ms  "
                  f"p99={row['p99_ms']:>7}ms  codes={json.dumps(row['codes'])}"
                  + (f"  ex:{row['err_sample']}" if row['err_sample'] else ""))
            time.sleep(args.settle_ms / 1000)
        token = http.login(args.admin_email, args.admin_password)  # refresh

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
