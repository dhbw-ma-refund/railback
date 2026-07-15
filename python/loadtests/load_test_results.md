# RailBack Backend — Stress Test Report

**Date:** 2026-07-14
**Target:** `https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws` (AWS Lambda Function URL, region eu-north-1)
**Auth:** `POST /auth/login` as `admin@railback.de` → `role=ADMIN` JWT (Bearer), TTL 900s. Same flow the frontend uses.
**Backend:** No source changes. Serverless Node lambdas (auth/user/admin handlers) over a single DynamoDB table.

---

## 1. Endpoints exercised

Discovered from source (`backend/lambdas/admin-handler/src/handler.ts`) and the S3-hosted admin app's API base (the Lambda Function URL; the S3 bucket itself is private — 403 — so endpoints were confirmed against the live API).

### Admin API — the workload under test
| Method | Path | DDB access pattern |
|---|---|---|
| GET | `/admin/stats` | Scan/Query aggregate, 30s in-process cache |
| GET | `/admin/tickets?limit=` | Query + pagination (list) |
| GET | `/admin/tickets/{ticketId}` | GetItem (single) |
| GET | `/admin/users?limit=&email=` | Query + prefix filter (list) |
| GET | `/admin/users/{email}` | GetItem (single) + recent tickets |
| PATCH | `/admin/tickets/{ticketId}` | UpdateItem (`admin_note` — non-destructive) |
| PATCH | `/admin/users/{email}` | UpdateItem (`telefon` — non-destructive) |

### Endpoints used only to seed realistic data (public, unauthenticated write path)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | create USER (scrypt hash + AES-256-GCM IBAN/BIC + PutItem) |
| POST | `/users/me/tickets/from-route` | create ticket in READY (TicketOwner + Ticket writes) |

**Writes were deliberately non-destructive:** PATCH targets are the free-form `admin_note` (tickets) and `telefon` (users) fields only. No state-machine transitions, no bank data, no deletes.

---

## 2. Data volume seeded

To make read load realistic (the table started with ~26 tickets), volume was seeded through the legitimate signup + ticket-creation endpoints:

- **~1,500 users** and **~7,000 tickets** total across seeding runs.
- **All seeded rows are marked as load-test data** and are filterable/removable:
  - email: `loadtest-<runId>-<n>@loadtest.example.de`
  - `vorname` / `nachname` / `strasse` / `ort` = `LOADTEST`
- Seeding itself measured the write path: **~490 writes/sec** sustained with **0 errors** at concurrency 60 (register + from-route).
- Seeded id/email pools saved to `/tmp/rb_seeded_*.json` for cleanup.

---

## 3. Load parameters

- Tool: custom Node 22 harness (global `fetch`, N concurrent workers, closed-loop — each worker fires the next request as soon as the previous returns).
- Per-request timeout: 15s. Request mix: **~80% reads / ~20% writes**, weighted toward list endpoints.
- Ramp: concurrency **10 → 20 → 50 → 100**, 30s per step (10s for the initial smoke).
- Pool: 5,001 ticket ids + 850 emails (800 known-ACTIVE seeded users as PATCH targets).

---

## 4. Measured performance

| Concurrency | RPS | Error rate | avg | p95 | p99 | max |
|---|---|---|---|---|---|---|
| 10 (smoke) | 27.1 | 0.36% | 363 ms | 897 ms | 5,356 ms | 5,821 ms |
| 20 | 61.9 | **2.27%** | 319 ms | 1,092 ms | 4,723 ms | 8,726 ms |
| 50 | 50.7 | **45.81%** | 838 ms | 2,809 ms | 5,164 ms | 9,193 ms |
| 100 | 99.7 | **59.72%** | 838 ms | 2,439 ms | 3,479 ms | 7,774 ms |

**Timeouts:** none (0 across all runs — the backend fails fast with 500s rather than hanging).

### Per-endpoint at c100 (worst case)
| Endpoint | n | ok | err | err% | avg | p99 |
|---|---|---|---|---|---|---|
| GET /admin/stats | 628 | 44 | 584 | 93% | 2,170 ms | 5,774 ms |
| GET /admin/tickets | 1045 | 104 | 941 | 90% | 837 ms | 2,031 ms |
| GET /admin/users | 439 | 35 | 404 | 92% | 749 ms | 1,691 ms |
| GET /admin/tickets/{id} | 531 | 416 | 115 | 22% | 378 ms | 1,930 ms |
| GET /admin/users/{email} | 390 | 346 | 44 | 11% | 240 ms | 1,582 ms |
| PATCH /admin/tickets/{id} | 445 | 345 | 100 | 22% | 402 ms | 1,959 ms |
| PATCH /admin/users/{email} | 253 | 213 | 40 | 16% | 337 ms | 2,090 ms |

---

## 5. Issues discovered

### 5.1 PRIMARY: DynamoDB throughput ceiling (provisioned capacity, not on-demand)
All 500s carry the same cause, surfaced in the response body:
> `ERR_INTERNAL` → *"Throughput exceeds the current capacity of your table or index. DynamoDB is automatically scaling… check if you have a hot key"* (`ProvisionedThroughputExceededException`).

- Errors begin at **c20 (2.3%)**, cliff to **45.8% at c50**, **59.7% at c100**.
- **RPS collapses under load**: c50 (50.7) is *lower* than c20 (61.9) — added load reduces throughput (retry amplification + throttling), the signature of a saturated provisioned table.
- The table **fully recovers within 15s** of load stopping (200s, 200–320ms) — the throttling is load-induced, not a persistent fault.

### 5.2 Scan/Query list endpoints collapse first; GetItem endpoints survive
Clear split by access pattern:
- **List routes** (`/admin/stats`, `/admin/tickets`, `/admin/users`) consume the most RCUs → **90–93% errors** at c100.
- **Single-item GetItem routes** (`/admin/users/{email}`, `/admin/tickets/{id}`) → **11–22% errors**.
- `/admin/stats` is the single worst endpoint (Scan-based aggregate). Its 30s in-process cache helps when warm (205ms) but the underlying compute still stampedes on cache miss under concurrency.

### 5.3 Throttling is surfaced as 500 ERR_INTERNAL, not 429
DynamoDB throttling (a retryable, client-side condition) is returned to the caller as **HTTP 500 `ERR_INTERNAL`** with no `Retry-After`. A dashboard client can't distinguish "back off and retry" from a genuine server fault, and browsers/proxies won't auto-retry a 500 the way they might a 429/503.

---

## 6. Recommendations

1. **Switch the table to on-demand (pay-per-request) billing**, or raise provisioned RCU/WCU + enable auto-scaling with a lower target-utilization. This is the single highest-impact fix — the table saturates at ~60 sustained RPS today. On-demand absorbs this class of spike without code changes.
2. **Add SDK-level retry with exponential backoff + jitter** on throttling exceptions inside the storage layer (the AWS SDK v3 default is only 3 attempts; raise `maxAttempts` and use adaptive retry mode). Most of the c20 errors would disappear behind transparent retries.
3. **Map throttling to HTTP 429 with `Retry-After`**, distinct from genuine 500s. Lets the frontend back off intelligently and keeps dashboards from showing hard errors during transient scaling.
4. **Kill the Scan in `/admin/stats`.** Maintain counters/aggregates incrementally (DynamoDB Streams → aggregate item, or atomic counter updates on write) so the KPI snapshot is an O(1) GetItem instead of a table Scan. Extend the cache TTL and add single-flight so a cache miss under load doesn't stampede.
5. **Paginate/limit `/admin/tickets` and `/admin/users` server-side by default** (cap page size, require the cursor) so a list call can't fan out into a large Query/Scan under load.
6. **Consider DAX or a read cache** for the hot list/aggregate reads if admin traffic is genuinely concurrent, to shield the table from read spikes.

---

## 7. Reproduction / artifacts (all under /tmp, outside the repo)

- `rb_seed.mjs` — marked-data seeder (register + from-route)
- `rb_pool.mjs` — builds id/email pool from seeded + live admin data
- `rb_load.mjs` — the load harness (ramp via `node rb_load.mjs <concurrency> <sec> <label>`)
- `rb_seeded_*.json` — seeded ids/emails for cleanup

**Cleanup note:** seeded rows are marked (`loadtest-*@loadtest.example.de`, `LOADTEST` names). They remain in the table for inspection; delete via the seeded-id pool files or by `?email=loadtest-` prefix filter when no longer needed. No repository files were created or modified.
</content>
