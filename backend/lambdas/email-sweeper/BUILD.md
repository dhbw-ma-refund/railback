# email-sweeper — Build / Deploy

> **Phase 2.6 status (2026-06-26)**: this lambda is **test-only**, same
> story as auth-handler / user-handler / admin-handler / refund-pdf.
> EventBridge cron triggers `handler()` on a `rate(5 minutes)` schedule
> in real deployment (Phase 5). Tests work via `@railback/mocks-in-memory`
> in `test/setup.ts`; real Lambda cold-start would throw `ERR_INTERNAL
> "no factory registered"` until Phase 5 wires the DDB-side `TicketRepo`
> impls (`queryEmailPending`, `scanEmailWatchdog`) and adds the
> `GSI_EMAIL_PENDING` GSI to the table.

## What it does

Runs two independent passes per cron invocation:

### Pass A — retry queue

1. Query `GSI_EMAIL_PENDING` ascending by SK (oldest `email_last_attempt`
   first), `limit=25` (DEFAULT_LIMIT — 25 SES sends per 5-min tick keeps us
   comfortably under the EventBridge window and SES-sandbox 1 req/s
   throughput). The GSI is sparse on the write side: only tickets
   with `email_status IN ("SENDING","FAILED_TRANSIENT") AND
   email_attempts<3 AND email_last_attempt` set AND `ticket_state="EMAIL_SENDING"`
   land in it. Callers don't re-filter.
2. For each queued ticket:
   - Re-load the live ticket row (TOCTOU guard — the
     `email-webhook` could have flipped the state between Query and the
     loop body).
   - Skip if `ticket_state !== "EMAIL_SENDING"` or `email_status` is not
     `SENDING`/`FAILED_TRANSIENT` or `email_attempts >= 3`.
   - Load the user row; missing user → terminal `EMAIL_FAILED +
     reason="render_missing"` (anonymisation race).
   - Load the rendered PDF metadata (`BlobRepo.getRenderedPdf`) + bytes
     (`BlobRepo.getBytes`). Missing either → terminal `EMAIL_FAILED +
     reason="render_missing"`. The sweeper cannot re-render — that's
     `refund-pdf`'s job.
   - Call `sendRefundEmail` from `@railback/lib/email/send-email`.
   - Branch on SES outcome:
     - `ok` → `email_status = SENT`, `email_provider_id = <MessageId>`,
       `email_attempts++`, `email_failed_reason = null`. The GSI write-side
       filter clears the index keys automatically (SENT is not in the
       populating-set).
     - non-2xx permanent (`MessageRejected`, `MailFromDomainNotVerified`,
       …) → terminal `EMAIL_FAILED + reason=<SES error name>`. Skips the
       `attempts<3` gate — permanent means permanent.
     - non-2xx transient, `nextAttempts < 3` → `email_status =
       FAILED_TRANSIENT`, `email_attempts++`, `email_failed_reason = null`.
       Stays in the queue for the next cron tick.
     - non-2xx transient, `nextAttempts >= 3` → terminal `EMAIL_FAILED +
       reason="max_retries"`.

Errors thrown inside a single ticket iteration are logged and swallowed so
one bad row doesn't poison the whole pass.

### Pass B — 24h watchdog

1. Compute cutoff `now - 24h`.
2. Scan for `ticket_state = "EMAIL_SENDING" AND email_status = "SENT" AND
   email_last_attempt < cutoff`.
3. For each match, patch to `ticket_state = "EMAIL_FAILED",
   email_status = "FAILED", email_failed_reason = "webhook_timeout"`.
   `email_attempts` and `email_last_attempt` are NOT touched — they're SES-
   side records of what actually happened; ops-relevant evidence stays.

Pass B catches the case where SES accepted the message (we got a 2xx) but
the SNS Delivery webhook never landed (network hiccup, webhook Lambda
broken, SNS topic mis-routed, …). After 24h we declare the loop unclosed
and terminal-fail the ticket so the user knows to resubmit.

Pass A and Pass B run in independent `try/catch` so a Pass B blow-up
doesn't mask a successful Pass A's count, and vice-versa.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes.
  Not used directly by the sweeper, but `@railback/lib/storage` may
  load user rows that decrypt IBAN/BIC on access.
- `RAILBACK_SES_FROM_ADDRESS` — verified SES sender, e.g.
  `noreply@railback.example`. Hard-fail if unset — see `send-email.ts`.
- `RAILBACK_SES_CONFIGURATION_SET` — optional; SES Configuration Set name
  wired up to the SNS event destination consumed by `email-webhook`.
- `RAILBACK_AWS_REGION` — defaults to `eu-north-1`.
- `RAILBACK_S3_BUCKET` — required when `RAILBACK_STORAGE=ddb` (Phase 5).
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).

## Assets

None.

## Local dev

Tests run at root-level Vitest:

```
cd backend
RAILBACK_STORAGE=memory \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
RAILBACK_SES_FROM_ADDRESS=noreply@example.invalid \
npx vitest run lambdas/email-sweeper
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/email-sweeper
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
No assets. `@aws-sdk/client-sesv2` is provided by the Lambda Node 20.x
runtime and gets marked external in the esbuild config.

## IAM (Phase 5)

- DynamoDB:
  - `Query` on `GSI_EMAIL_PENDING` (retry-queue lookup)
  - `Scan` on the table with `FilterExpression` (watchdog)
  - `BatchGetItem` or `GetItem` on `PK=USER#<email>|SK=TICKET#<ticketId>`
    (hydrate after GSI Query)
  - `UpdateItem` on `PK=USER#<email>|SK=TICKET#<ticketId>` (state patch)
  - `GetItem` on `PK=USER#<email>|SK=RENDERED#<ticketId>` (metadata lookup)
- S3:
  - `s3:GetObject` on `rendered/*` (re-fetch the merged PDF for retry)
- SES: `ses:SendEmail` (raw MIME).
- KMS: none (env-var KEK).
- CloudWatch Logs: default.
