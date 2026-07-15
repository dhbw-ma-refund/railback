# RailBack — Read-Path Results (per-query-pattern isolation)

Measured against the live API on existing data (~1,500 users / ~7,000 tickets,
all `READY`). Read-only — nothing created or deleted. Each documented access
pattern (`03_query_patterns.typ` §2a + stats/users) run in isolation, concurrency
ramped 1→5→10→20→40, 60 requests per level.

Target: `https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws`
Script: `python/loadtests/read_path.py`

## Per-request cost at c=1 (clean signal, no contention)

| Pattern | Doc class | RPS | avg ms | cost vs baseline |
|---|---|---|---|---|
| GET /admin/users/{email} | G GetItem | 16.0 | 63 | 1x |
| GET /admin/tickets/{id} | G GetItem | 13.2 | 76 | 1.2x |
| tickets?trainNr&date | Q gsi1 (Route 1) | 12.6 | 80 | 1.3x |
| tickets?email | Q base (Route 2) | 11.5 | 87 | 1.4x |
| stats | S×2 (cached) | 8.7 | 115 | 1.8x |
| tickets (no filter) | **S base (Route 3)** | 2.9 | 350 | **5.5x** |
| tickets?state=READY | **S base (Route 3)** | 2.3 | 433 | **7x** |
| users?limit=50 | **Q + N+1** | 2.0 | 499 | **8x** |
| users?email=prefix | **Q + N+1** | 1.9 | 526 | **8x** |

## Error rate (HTTP 500 ProvisionedThroughputExceeded) by concurrency

| Pattern | c=1 | c=5 | c=10 | c=20 | c=40 |
|---|---|---|---|---|---|
| GET /admin/tickets/{id} (GetItem) | 0% | 0% | 0% | 0% | 0% |
| GET /admin/users/{email} (GetItem) | 0% | 0% | 0% | 0% | 0% |
| tickets?trainNr&date (Query gsi1) | 0% | 0% | 0% | 0% | 0% |
| tickets?email (Query base) | 0% | 0% | 0% | 0% | 0% |
| tickets?state (Scan) | 0% | 0% | 0% | 0% | 0% |
| tickets nofilter (Scan) | 0% | 0% | 0% | 0% | **1.7%** |
| stats (Scan×2) | 0% | 0% | 0% | **3.3%** | 0%* |
| users?limit (N+1) | 0% | 0% | 0% | 0% | 0% |
| users?email prefix (N+1) | 0% | 0% | 0% | 0% | 0% |

\* stats c=40 read 0% because the 30s cache stayed warm that window; the c=20
miss caught a cache-rebuild stampede (2×500).

## Peak RPS reached (higher = cheaper per request)

| Pattern | peak RPS | scales? |
|---|---|---|
| GET /admin/tickets/{id} | 235 | yes, linear, 0 errors |
| GET /admin/users/{email} | 236 | yes, linear, 0 errors |
| tickets?email (Query) | 124 | yes |
| tickets?trainNr&date (Query) | 51 | yes (smaller partition) |
| tickets nofilter (Scan) | 36 | **plateaus, throttles** |
| users N+1 | 32 | **plateaus** |
| tickets?state (Scan) | 26 | **plateaus** |
| stats | 14 | **plateaus (cache-bound)** |

## Verdict — which pattern causes the throttling

Ranked by capacity cost:

1. **`GET /admin/users` — N+1 fan-out (worst per-request cost, ~8x).**
   `get-users.ts` runs `tickets.adminList({email, limit:100000})` for EACH user
   in the page → one HTTP request becomes 1 + N partition Queries. Plateaus at
   ~32 RPS regardless of concurrency (capacity-bound, not latency-bound).
2. **`GET /admin/tickets` Route 3 — base-table Scan (~5–7x).** Triggered by
   `?state=` alone or no train/email filter. Cost scales with total table size;
   first pattern to emit a throttle 500 in isolation.
3. **`GET /admin/stats` — double full-table Scan.** Cheap while the 30s cache is
   warm, spikes on concurrent cache-miss (3.3% errors at c=20, p99 ~7s).

**Not the cause — scale cleanly to 120–236 RPS with zero errors:** both GetItem
routes and both Query routes (Route 1 gsi1, Route 2 base).

## Why the earlier mixed test hit ~60% errors but isolation barely throttles

Throttling is driven by **aggregate consumed RCU**, not any single call. In
isolation each expensive pattern mostly stays just under the table's provisioned
ceiling (≤3.3% here). Under mixed load the Scans (Route 3, stats) and the N+1
(users) burn the shared RCU budget disproportionately, and running them together
pushes total consumption past the limit — so the whole API sheds 500s, including
the cheap calls caught in the crossfire.

## Fixes (in priority order)

1. **Switch the table to on-demand billing.** The doc (`01_single_table_design`)
   already specifies `PAY_PER_REQUEST`; the live table is provisioned. This one
   infra change raises the ceiling all three hot patterns hit.
2. **Kill the `/admin/users` N+1** — denormalize `ticket_count` / `total_refunded`
   onto the UserProfile row, updated on ticket write.
3. **Add a `ticket_state` GSI** so the review-queue (`?state=`) is a Query, not a
   Scan (doc §"Scans" flags this as the first scaling candidate).
4. **Replace the stats Scan with incremental counters** + single-flight on cache
   miss so a cold cache under load doesn't stampede.
5. **SDK retry with backoff + jitter**; map throttling to HTTP 429 + `Retry-After`
   instead of opaque 500 `ERR_INTERNAL`.
</content>
