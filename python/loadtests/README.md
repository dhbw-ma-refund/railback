# RailBack Load Tests

Load tests for the live RailBack API (AWS Lambda Function URL over DynamoDB
single-table, `eu-north-1`). Two suites, split by whether they touch data:

| Script | Touches data? | Needs AWS creds? | Answers |
|---|---|---|---|
| `read_path.py` | **No** — read-only on existing data | No | Which query pattern throttles the table, and at what concurrency? |
| `write_path.py` | **Yes** — creates then hard-deletes | **Yes** (for the delete) | How fast can we write (register + ticket create) and hard-delete? |

Both hit the same API the frontend uses: `POST /auth/login` for a
`role=ADMIN` JWT, then the `/admin/*` and `/users/*` routes.

---

## Which suite do I run?

- **"Is the API slow / which pattern is the problem?"** → `read_path.py`. Safe to
  run anytime; it never changes data. Run it against a table that already has
  data (it samples real keys at startup and fails fast if the table is empty).
- **"How fast can it ingest / clean up?"** → `write_path.py`. This is the only
  suite that writes. It creates marked load-test rows, measures create+delete
  throughput, and hard-deletes everything it made. Requires AWS credentials
  because the only correct cleanup is a direct-DynamoDB cascade (see Cleanup).

Run the **read** suite freely; run the **write** suite when you specifically want
to measure ingest/delete and you have creds. Typical order for a fresh
environment: `write_path.py` to populate + measure writes, then `read_path.py`
to measure reads against that data. If the table already has data, just run
`read_path.py`.

---

## Setup

```bash
cd python
uv sync                     # installs boto3 (write_path needs it for hard-delete)
```

TLS: run everything through `uv run` (the venv has a working CA bundle). The
system `python3` on this machine has a broken CA store — if you must use it and
see `CERTIFICATE_VERIFY_FAILED`, set `SSL_CERT_FILE=$(python -m certifi)`. The
scripts already fall back to certifi/botocore's bundle when present.

---

## `read_path.py` — read-only pattern isolation

Runs each documented access pattern (`../../../railback-schema-docs/03_query_patterns.typ`
§2a + stats/users) **in isolation**, ramping concurrency, so you can attribute
throttling to a specific pattern instead of a blur of mixed traffic. Samples real
keys (a ticketId, an email, a trainNr+date) from existing rows at startup.

```bash
uv run python loadtests/read_path.py \
    --base https://<lambda-url>.lambda-url.eu-north-1.on.aws \
    --admin-email admin@railback.de --admin-password '<pw>' \
    --levels 1,5,10,20,40 --requests-per-level 60 \
    --out /Users/<you>/Documents/railback-schema-docs
```

Flags: `--levels` (concurrency steps), `--requests-per-level`, `--settle-ms`
(gap between levels so one pattern's throttle doesn't bleed into the next),
`--timeout`, `--out`.

Output: `read_path_<ts>.json` + `read_path_<ts>.md` in `--out`. Read-only —
creates and deletes nothing.

## `write_path.py` — create + hard-delete throughput

Two measured phases:
- **CREATE** — registers N users (`POST /auth/register`: scrypt + AES-GCM +
  PutItem) and M tickets each (`POST /users/me/tickets/from-route`:
  TransactWriteItems). Reports write RPS and register/ticket latency percentiles.
- **DELETE** — hard-deletes every created user via
  `db.connector.RailBackConnector.delete_user()` (removes the whole
  `USER#<email>` partition: profile + tickets + owner rows), verified by
  re-query. Reports delete RPS.

```bash
# Plan only — no creds, touches nothing:
uv run python loadtests/write_path.py --base https://<lambda-url>... --dry-run

# Real run (needs AWS creds; aborts at preflight if it can't hard-delete):
uv run python loadtests/write_path.py \
    --base https://<lambda-url>.lambda-url.eu-north-1.on.aws \
    --users 200 --tickets-per-user 4 \
    --create-concurrency 40 --delete-concurrency 20 \
    --out /Users/<you>/Documents/railback-schema-docs
```

Flags: `--users`, `--tickets-per-user`, `--create-concurrency`,
`--delete-concurrency`, `--timeout`, `--out`, `--dry-run`.

Output: `write_path_<ts>.json` + `write_path_<ts>.md` in `--out`.

**Preflight safety:** before creating anything it writes a canary row and proves
`delete_user` removes it. No creds or a failed canary → it aborts without
creating data. A run that can't clean up would permanently pollute the table.

---

## Cleanup model — important

- **The API has no hard delete.** `DELETE /users/me` is a **soft delete**:
  `scheduleDeletion()` flips the profile to `DELETION_SCHEDULED` with
  `ttl = now + 30d` and never touches ticket/owner rows. Soft-deleting seeded
  data would tombstone profiles for ~30 days and orphan every ticket **forever**.
- **So `write_path.py` purges via direct DynamoDB**
  (`RailBackConnector.delete_user`), deleting the whole `USER#<email>` partition
  and verifying each row is gone by re-query.
- **Markers** on every created row: email
  `loadtest-<runId>-<n>@loadtest.example.de`, and
  `vorname`/`nachname`/`strasse`/`ort` = `LOADTEST`. Find leftovers with
  `GET /admin/users?email=loadtest-`; delete with `conn.delete_user(email)`.

---

## Findings to date (measured against the live API)

**Read path — which pattern throttles (isolation, existing ~7k tickets):**
- **Culprits (consume RCU out of proportion, plateau/throttle):**
  1. `GET /admin/users` — N+1 fan-out (`tickets.adminList` per row), ~8× cost,
     plateaus ~32 RPS.
  2. `GET /admin/tickets` Route 3 — base-table Scan (`?state=` alone or no
     filter), ~5–7× cost.
  3. `GET /admin/stats` — double full-table Scan; spikes on cache miss (500s at
     c=20–40).
- **Healthy (scale cleanly):** `GET /admin/tickets/{id}`,
  `GET /admin/users/{email}` (GetItem), `GET /admin/tickets?trainNr=&date=`
  (Query gsi1), `GET /admin/tickets?email=` (Query base).

**Fast patterns pushed to extreme concurrency (100→2000, read-only):**
- Peak ~**2200 RPS at concurrency 250**, 0 errors, p99 < 500ms.
- Throughput degrades past c=500; at c=1000/2000 errors appear but they are
  **connection `NETERR`/`TIMEOUT`, never HTTP 500 DynamoDB throttling** (0 × 500
  at every level). The fast patterns saturate **Lambda/connection concurrency**,
  not the table.
- Contrast: the Scan/N+1 patterns throttle DynamoDB (`ProvisionedThroughput
  ExceededException` → 500) at concurrency < 40. **Two different bottlenecks.**

**Root cause + fixes:**
- The table is on **provisioned** capacity though `01_single_table_design.typ`
  specifies `PAY_PER_REQUEST`. Switching to on-demand is the highest-impact fix.
- Then: kill the `/admin/users` N+1 (denormalize `ticket_count`/`total_refunded`
  onto the profile), add a `ticket_state` GSI so the review-queue is a Query not
  a Scan, replace the stats Scan with incremental counters + single-flight, and
  map throttling to HTTP 429 + `Retry-After` with SDK backoff.

Results files (`read_path_*.md`, `write_path_*.md`) are written to the
`--out` directory (the team keeps them in `railback-schema-docs/`).
</content>
