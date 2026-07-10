# sepa-reports — Build / Deploy

> **Phase 2.10 status (2026-07-01)**: this lambda is **test-only**, same
> story as pain008-generator / refund-pdf / admin-handler / user-handler.
> S3 ObjectCreated is not wired locally — tests call `processReport`
> directly with hand-crafted `{s3Bucket, s3Key}` after seeding the blob into
> the in-memory BlobRepo. Real Lambda cold-start would throw
> `ERR_INTERNAL "no factory registered"` for the same reason — resolution
> lands in Phase 5 alongside real DDB + S3 storage wiring.

## What it does

S3-event-triggered on the `sepa-reports/*` prefix. An admin uploads a
pain.002 / camt.054 / camt.053 XML via the presigned POST issued by
`POST /admin/sepa/reports/upload`; that PutObject fires an ObjectCreated
notification into this Lambda. Per record:

1. Decompose the S3 key `sepa-reports/<YYYY-MM-DD>/<reportId>.xml`.
   `reportId` is the ULID chosen by admin-handler at presign time AND the
   idempotency key. Non-matching keys throw `ERR_VALIDATION` — the presign
   policy pins the shape.
2. Idempotency: `db().sepaReports.getByReportId(date, reportId)`. If a row
   exists, log `sepa_reports.skip.already_ingested` and return. Handles
   the S3-event replay case (SNS retries, DLQ replays).
3. GET the bytes via `db().blobs.getBytes(key)`. Missing → `ERR_NOT_FOUND`
   throw (S3 will retry; the notification can outrun replication).
4. Sniff the XML root with a regex to pick the parser
   (`detect-kind.ts`). Unknown roots throw `ERR_VALIDATION`.
5. Parse via `@railback/lib/sepa/parse-reports` (pain.002 / camt.054 /
   camt.053 branches).
6. Warn on `parsed.reportId (GrpHdr/MsgId) !== keyReportId` — S3-key
   basename is canonical for idempotency.
7. Resolve each parsed `mandateId → SepaMandate | null` via new
   `MandateRepo.getByMandateId` (linear scan in v1; Phase 5 DDB impl
   should add a `mandate_id` GSI or reuse the `TicketOwner` pointer
   pattern from CLAUDE.md).
8. Compute decisions via `apply-transitions.decideBatch` — pure fn,
   trivially unit-tested. State-machine per DB_SCHEMA.md §"mandate_state
   transitions M3–M6":

   | Trigger | Legal source state | Target |
   |---|---|---|
   | `pain.002 REJECTED` | `SUBMITTED` | `REVERSED` |
   | `pain.002 ACCEPTED` | any | SKIP (informational; camt.054 does the debit) |
   | `camt.054 BOOKED` | `SUBMITTED` | `DEBITED` |
   | `camt.054 REVERSED` | `SUBMITTED` \| `DEBITED` | `REVERSED` |
   | `camt.054 DISPUTED` (MD06 only) | `DEBITED` | `DISPUTED` |
   | `camt.053` (any) | any | SKIP (informational statement) |

   Illegal source-state transitions log
   `sepa_reports.transition.illegal` and become SKIP. Unknown mandates
   (resolver returned null) log `sepa_reports.mandate.unknown` and become
   SKIP with `skipReason=unknown_mandate`.
9. Apply decisions in order, per-decision `try/catch`. Order:
   `tickets.patch(service_fee_state)` → `mandates.mark<Debited|Reversed|Disputed>`.
   Ticket-first mirrors `anonymisation-sweeper/src/expire-mandates.ts` —
   see DB_SCHEMA.md §"service_fee_state mirror". Failure of one decision
   does NOT halt the batch; the SepaReport audit row is still written.
10. For decisions with `shouldNotify=true` (classified reason code with
    `userNotify=true`, e.g. `AC04`, `MD06`, `MD07`), send an R-tx
    notification email via `notify.sendRtxNotifyEmail`. Never-throws;
    failures are logged and don't roll back the state change.
11. Write the `SepaReport` audit row via `db().sepaReports.put`, with
    `mandates_correlated` set to every parsed `mandateId` (including
    SKIPs — the row is a real audit trail, not just a success log).

### Write order (ticket-first, mandate-second)

Same discipline as `anonymisation-sweeper/src/expire-mandates.ts`:
`tickets.patch(service_fee_state)` runs before
`mandates.mark<Debited|Reversed|Disputed>`. If step 1 throws, we do not
touch the mandate — the mirror stays consistent. If step 2 throws, the
ticket's `service_fee_state` is ahead of the mandate for one tick;
documented as acceptable (self-heals on the next inbound report if the
bank re-notifies, or via manual admin reconciliation).

### Idempotency

The SepaReport row's PK/SK is `(SEPA#REPORT#<date>, REPORT#<reportId>)`
with `reportId = S3-key basename`. `getByReportId` before `put` closes
the retry-replay window in memory-mode. Phase-5 DDB impl MUST use
`ConditionExpression: attribute_not_exists(SK)` on `put` — the in-memory
`put` currently overwrites, but the pre-check catches all live replays.

Pain.002 `MsgId` inside the XML is compared to the key-derived
`reportId` and a mismatch logs a warning. The key-derived value wins
(admin filename is the canonical id — we chose it, the bank echoes it in
pain.002 but not necessarily in camt.05x envelopes).

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda (Phase 5).
- `RAILBACK_S3_BUCKET` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
- `RAILBACK_AWS_REGION` — SES region (default `eu-north-1`).
- `RAILBACK_SES_FROM_ADDRESS` — R-tx notification From-address. Missing =
  hard `ERR_INTERNAL` at first email (config error, not runtime hiccup).
- `RAILBACK_SES_CONFIGURATION_SET` — optional; used for outbound event
  destinations (Delivery/Bounce/Complaint). Not required for R-tx
  notifications since we don't watch their delivery state.

## Local dev

Tests run at root-level Vitest (per DECISIONS.md — no per-workspace
`test` script):

```
cd backend
RAILBACK_STORAGE=memory \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
RAILBACK_SES_FROM_ADDRESS="noreply@railback.example" \
npx vitest run lambdas/sepa-reports
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/sepa-reports
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
No bundled assets. `@aws-sdk/*` provided by the Lambda Node 20.x runtime
(marked external). No native deps.

## IAM (Phase 5)

- S3:
  - `s3:GetObject` on `sepa-reports/*` (read admin-uploaded XML)
- DynamoDB:
  - `Query`/`GetItem` on `PK = USER#<email>` (resolve mandate rows)
  - `UpdateItem` on `PK = USER#<email>|SK = TICKET#<ticketId>#MANDATE`
    (mark <Debited|Reversed|Disputed>)
  - `UpdateItem` on `PK = USER#<email>|SK = TICKET#<ticketId>` (mirror
    `service_fee_state`)
  - `PutItem` on `PK = SEPA#REPORT#<date>|SK = REPORT#<reportId>` with
    `ConditionExpression: attribute_not_exists(SK)`
  - `Scan` for `getByMandateId` linear-scan fallback (or drop when the
    Phase-5 GSI on `mandate_id` lands)
- SES:
  - `ses:SendEmail` on the verified From-address (R-tx notify emails)
- CloudWatch Logs: default.

## S3 trigger config (Phase 5)

- Bucket: `railback-storage`
- Event: `s3:ObjectCreated:*`
- Filter: prefix `sepa-reports/`, suffix `.xml`
- DLQ: SQS queue at `sepa-reports-dlq`, redrive after 3 retries. Parse
  errors should NOT be silent — DLQ triage is the operator's signal that
  an admin uploaded a malformed file.
