# refund-pdf — Build / Deploy

> **Phase 2.5 status (2026-06-25)**: this lambda is **test-only**, same
> story as auth-handler / user-handler / admin-handler. Sync-invoked
> from `user-handler` `POST /users/me/tickets/{ticketId}/refund` via a
> dynamic-import shim — see `lambdas/user-handler/src/routes/post-refund.ts`
> `invokeRefundPdf()`. With the module now installed in the workspace,
> the import resolves and `renderAndSend({ email, ticketId })` runs
> in-process during user-handler tests too.
>
> Same deploy gap as the other lambdas: production `handler.ts` reaches
> `db()` from `@railback/lib/storage` without side-effect-registering a
> backend. Tests work via `@railback/mocks-in-memory` in `test/setup.ts`.
> Real Lambda cold-start would throw `ERR_INTERNAL "no factory registered"`.
> Resolution lands in Phase 5 alongside the real DDB-side
> `lib/storage/ddb/` impls + the matching S3-side `lib/storage/s3/`
> wiring already in place.

## What it does

1. Load ticket; bail if not in `EMAIL_SENDING` (state-guard) or already
   `SENT`/`DELIVERED` (idempotency).
2. Load user; resolve IBAN/BIC from `SepaMandate` snapshot (preferred —
   locked at submit time) or fall back to user profile (zero-fee waiver
   path). Decrypt via `@railback/lib/crypto/iban`.
3. Render the EU-form with `pdf-lib`: load the bundled template, fill 47
   AcroForm fields via `@railback/lib/refund/eu-form-fields`,
   `form.flatten()`, save.
4. Merge belege into the flattened EU-form: PDFs via `copyPages`, JPG/PNG
   via `embedJpg`/`embedPng` + `addPage`. Oversize handling = replace next
   page with a "weitere Belege bei Rückfrage nachreichbar" notice page;
   never silent drop.
5. Persist merged bytes to S3 at `rendered/<emailHash>/<ticketId>.pdf`
   (via `BlobRepo.putBytes`) + write `RENDERED#<ticketId>` metadata row
   (via `BlobRepo.putRenderedPdf`).
6. Send via SES (`@aws-sdk/client-sesv2` `SendEmailCommand` with raw
   MIME). Custom header `X-Ticket-Id: <ticketId>` so the SNS-routed
   delivery/bounce/complaint event correlates back to the ticket.
7. Patch the ticket on SES outcome:
   - 2xx → `email_status = SENT`, `email_provider_id = <MessageId>`,
     `email_attempts++`. Ticket stays in `EMAIL_SENDING` awaiting the
     SNS-driven `email-webhook` Lambda.
   - non-2xx transient → `email_status = FAILED_TRANSIENT`,
     `email_attempts++`, `email_failed_reason = null`. The SES error
     name lives in the structured log line (`refund-pdf.ses.transient`)
     only — DB_SCHEMA's `email_failed_reason` enum has no free-text SES
     name; setting a value that isn't in the enum would break
     downstream projections. `email-sweeper` picks it up on the next
     5-min cron tick and retries.
   - non-2xx permanent (`MessageRejected`,
     `MailFromDomainNotVerifiedException`,
     `ConfigurationSetDoesNotExistException`, etc.) →
     `ticket_state = EMAIL_FAILED`, `email_status = FAILED`,
     `email_failed_reason = "max_retries"`. Terminal. SES error name
     again only in the log line.

`renderAndSend` never throws on SES failures — those are normal retry
paths. On render/persist errors it rolls the ticket state back to `READY`
+ clears the submit-time email/timestamp fields (audit-fix 2026-07-01
adds this transition to `DB_SCHEMA.md` as `EMAIL_SENDING → READY` per
`render-fail-rollback-unplanned`) and re-throws as 5xx so the user's
wizard can retry from a clean slate.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes
- `RAILBACK_SES_FROM_ADDRESS` — verified SES sender, e.g.
  `noreply@railback.example`. Default `noreply@example.invalid` so a
  missing env blows up at SES rather than silently in prod.
- `RAILBACK_SES_CONFIGURATION_SET` — optional; SES Configuration Set name
  wired up to the SNS event destination consumed by `email-webhook`.
- `RAILBACK_AWS_REGION` — defaults to `eu-central-1`.
- `RAILBACK_S3_BUCKET` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
  In `memory` mode the in-memory BlobRepo writes into its own
  `memory-mock` bucket — `persist.ts` mirrors that fallback.
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).

## Assets

- `assets/reimbursement-form_de.pdf` (~265 KB) — bundled in the Lambda zip.
  Loaded once per cold-start via `node:fs/promises.readFile`. Resolved
  relative to `import.meta.url`, so the zip layout must keep `assets/`
  next to `src/` at the package root.

## Local dev

Tests run at root-level Vitest (per DECISIONS.md — there is no
per-workspace `test` script):

```
cd backend
RAILBACK_STORAGE=memory \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
RAILBACK_SES_FROM_ADDRESS=noreply@example.invalid \
npx vitest run lambdas/refund-pdf
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/refund-pdf
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
Bundle MUST keep `assets/reimbursement-form_de.pdf` at the same relative
path the source resolves (`<package-root>/assets/`), which means the zip
contains:

- `index.js` (bundled handler + lib)
- `assets/reimbursement-form_de.pdf`

`@aws-sdk/client-sesv2` is provided by the Lambda Node 20.x runtime and
gets marked external in the esbuild config. `pdf-lib` is pure JS and gets
inlined (no native deps).

## IAM (Phase 5)

- DynamoDB:
  - `Query` on `PK=USER#<email>` (read ticket + mandate rows)
  - `UpdateItem` on `PK=USER#<email>|SK=TICKET#<ticketId>` (email-state
    patch)
  - `PutItem` on `PK=USER#<email>|SK=RENDERED#<ticketId>` (metadata row)
- S3:
  - `s3:GetObject` on `belege/*` (read beleg bytes for merge)
  - `s3:PutObject` on `rendered/*` (write merged PDF)
- SES: `ses:SendEmail` (raw MIME).
- KMS: none (env-var KEK).
- CloudWatch Logs: default.
