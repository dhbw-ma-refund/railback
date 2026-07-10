# anonymisation-sweeper — Build / Deploy

> **Phase 2.7 status (2026-06-26)**: this lambda is **test-only**, same
> story as auth-handler / user-handler / admin-handler / refund-pdf /
> email-sweeper. EventBridge cron triggers `handler()` on a `rate(1 day)`
> schedule in real deployment (Phase 5). Tests work via
> `@railback/mocks-in-memory` in `test/setup.ts`; real Lambda cold-start
> would throw `ERR_INTERNAL "no factory registered"` until Phase 5 wires
> the DDB-side repo impls (the seven new methods listed in CLAUDE.md /
> the foundation step).

## What it does

Runs two independent passes per cron invocation:

### Pass A — GDPR cascade

For every user with `user_state="DELETION_SCHEDULED" AND ttl<now` (epoch
seconds, DDB convention):

1. `TicketRepo.anonymiseUserTickets(email, anonPk, nowIso)` — rewrites every
   real-ticket SK under `USER#<email>` to `anonPk =
   USER#sha256:<sha256Hex(normaliseEmail(email))>`, strips PII fields per
   DB_SCHEMA.md §"Cascade on user delete" item 3 (`vorname_aus_ticket`,
   `nachname_aus_ticket`, `fahrt_fahrkartennummer`, `antragstellung_ort`,
   `antragstellung_datum`, `zusaetzliche_angaben`), refreshes `updated_at`.
   Returns the touched ticketIds for the per-ticket cascade below.
2. `MandateRepo.anonymiseUserMandates(email, anonPk)` — same PK rewrite,
   nulls `iban_enc`, `bic_enc`, `kontoinhaber_snapshot`, `user_consent_ip`,
   `user_consent_user_agent`. Preserves `pain008_*`, `debited_at`,
   `reversed_*`, `dispute_opened_at`, `expires_at`, `issued_at`, `ttl` —
   HGB retention overrides DSGVO erasure for buchungsrelevante audit
   trails. `pain008` S3 audit XML is **not** deleted. Likewise the
   `sepa-reports/` S3 prefix (admin-uploaded pain.002 / camt.054 inbound
   XML) is **not** deleted — same HGB-retention rationale, retained for
   10 years.
3. `RouteTemplateRepo.deleteAllForUser(email)` — hard-delete every
   `TEMPLATE#`-row. No S3 side; templates only carry label + station
   metadata.
4. Per anonymised ticketId, hard-delete:
   - `BlobRepo.deleteRawUpload(email, ticketId)` (DDB row + S3 object)
   - `BlobRepo.deleteRenderedPdf(email, ticketId)` (ditto)
   - `BlobRepo.deleteAllReceipts(email, ticketId)` (multiple receipts in
     one call)
   - `TicketOwnerRepo.delete(ticketId)` (mapping row drops with the user)
5. `UserRepo.deleteByEmail(email)` — drop the profile row eagerly so the
   next sweep is idempotent.

Per-user errors are caught at the outer loop; per-blob errors inside the
ticket cascade are also swallowed individually — the cascade is
best-effort and we never want to leave a half-anonymised user behind
because one S3 delete blew up.

### Pass B — Mandate expiry

For every mandate matching `mandate_state="ISSUED" AND expires_at<now`
(`MandateRepo.listExpiringISSUED(nowIso)`):

1. `MandateRepo.markExpired(email, ticketId)` — flips mandate_state to
   `EXPIRED`.
2. `TicketRepo.patch(email, ticketId, { service_fee_state: "WAIVED" })` —
   mirrors onto the linked ticket. If the ticket is gone (orphan
   mandate or Pass-A-anonymised this invocation), log a warn and keep
   the mandate flip — we do not roll back.

Idempotent: `listExpiringISSUED` filters by `mandate_state="ISSUED"` so a
re-run never re-touches an already-EXPIRED mandate.

Pass A and Pass B run in independent `try/catch`. Per-pass failures do
not affect the other pass's counters in the summary log.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes. The
  sweeper itself does not decrypt anything, but `@railback/lib/storage`
  may resolve user rows that touch the KEK on access.
- `RAILBACK_AWS_REGION` — defaults to `eu-north-1`.
- `RAILBACK_S3_BUCKET` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).

No SES envs — the sweeper does not send email. No KMS — env-var KEK.

## Assets

None.

## Local dev

Tests run at root-level Vitest:

```
cd backend
RAILBACK_STORAGE=memory \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
npx vitest run lambdas/anonymisation-sweeper
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/anonymisation-sweeper
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
No assets. `@aws-sdk/client-dynamodb` + `@aws-sdk/client-s3` are provided
by the Lambda Node 20.x runtime and get marked external in the esbuild
config.

## IAM (Phase 5)

- DynamoDB:
  - `Scan` on the table (Pass A user scan, Pass B mandate scan)
  - `Query` on `PK=USER#<email>` (child-row enumeration during cascade)
  - `UpdateItem` / `PutItem` on `PK=USER#<email>|SK=TICKET#<…>` (ticket
    anonymise — write to anon-PK, delete live-PK)
  - `UpdateItem` / `PutItem` on `PK=USER#<email>|SK=TICKET#<…>#MANDATE`
    (mandate anonymise + markExpired)
  - `DeleteItem` on every child SK under `USER#<email>` (templates / raw /
    rendered / belege / profile)
  - `DeleteItem` on `PK=TICKET#<id>|SK=OWNER` (mapping rows)
- S3:
  - `s3:DeleteObject` on `raw/*`, `rendered/*`, `belege/*` (cascade delete)
  - **No `s3:DeleteObject` on `pain008/*`** — HGB-retained audit trail.
  - **No `s3:DeleteObject` on `sepa-reports/*`** — same rationale
    (admin-uploaded pain.002 / camt.054 inbound XML, 10y retention).
- SES: none.
- KMS: none.
- CloudWatch Logs: default.
