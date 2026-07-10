# email-webhook — Build / Deploy

> **Phase 2.6 status (2026-06-26)**: this lambda is **test-only**, same
> story as the other lambdas. SNS-invoked Lambda is created in Phase 5
> alongside the SES Configuration Set + SNS topic wiring.
>
> Production `handler.ts` reaches `db()` from `@railback/lib/storage`
> without side-effect-registering a backend — tests use
> `@railback/mocks-in-memory` via `test/setup.ts`. Real Lambda cold-start
> would throw `ERR_INTERNAL "no factory registered"` until the Phase 5
> DDB-side lib registration lands.

## What it does

Lambda is the SNS subscriber of the SES Configuration Set Event Destination
topic. SES Configuration Sets fire `Send`, `Delivery`, `Bounce`,
`Complaint`, `Reject`, `Open`, `Click` events; we only react to
`Delivery` / `Bounce` / `Complaint` and silently drop the rest.

Per record (SNS may batch multiple events in one Lambda invocation):

1. Parse the wrapped envelope: `record.Sns.Message` is a JSON string
   containing the SES event. Unrecognised JSON / event type → log warn,
   continue.
2. Extract `X-Ticket-Id` from `mail.headers` (case-insensitive — mail
   clients may re-case custom headers). Missing → log warn, continue.
3. Look up `(ticketId → email)` via `TicketOwnerRepo.get(ticketId)`. The
   mapping row is written by `user-handler` `POST /tickets/from-route` and
   `POST /upload-confirm` once per ticket creation (CLAUDE.md "TicketOwner
   mapping row"). Missing → log warn, continue.
4. Load the ticket via `tickets.get(email, ticketId)`. Missing (parent
   anonymised between SES event and webhook fire) → log warn, continue.
5. Dispatch:
   - **`Delivery`** → `ticket_state: PENDING_DB_PAYMENT`,
     `email_status: DELIVERED`, clear `email_failed_reason`. Idempotent;
     out-of-order Deliveries arriving after `EMAIL_FAILED` are dropped
     (terminal stays terminal).
   - **`Bounce`** → `ticket_state: EMAIL_FAILED`, `email_status: BOUNCED`,
     `email_failed_reason: "bounced"`. **Only if the ticket is still in
     the email window** (`EMAIL_SENDING` or earlier). A bounce arriving
     after `PENDING_DB_PAYMENT` / `APPROVED` / `COMPLETED` is a no-op —
     the state past `EMAIL_SENDING` is committed and no longer belongs
     to the email pipeline (window-guard fix, 2026-06-26 external
     review). Idempotent on `EMAIL_FAILED`.
   - **`Complaint`** → same window-guard as `Bounce`; on match,
     `ticket_state: EMAIL_FAILED`, `email_status: BOUNCED`,
     `email_failed_reason: "complained"`. Complaints reuse the `BOUNCED`
     enum value (no dedicated `COMPLAINED` value per ARCHITECTURE.md).

Each record runs in its own try/catch so one bad record cannot block the
rest. **Payload-invalid records** (missing header, wrong shape, unknown
event type) are swallowed with a warn-log — SNS would otherwise retry
the batch indefinitely without ever succeeding. **Storage-side errors**
(DDB throttling, network) propagate so SNS retries → DLQ eventually
surfaces the issue instead of masking it (external-review fix
2026-06-26). Handler is idempotent so retries are safe.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda.
- `RAILBACK_AWS_REGION` — defaults to `eu-north-1`.
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5).

No SES env vars — the webhook never calls SES.
No S3 env vars — the webhook never touches blobs.
No KEK env var — the webhook never decrypts.

## Assets

None.

## Local dev

```
cd backend
RAILBACK_STORAGE=memory \
npx vitest run lambdas/email-webhook
```

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/email-webhook
```

## Zip (Phase 5)

Single esbuild CJS bundle of `src/index.ts` with `@railback/lib` inlined.
No native deps, no assets — the zip is just `index.js`.

## SNS wiring (Phase 5)

1. SES Configuration Set with an Event Destination of type SNS, targeting
   `Send`, `Delivery`, `Bounce`, `Complaint`.
2. SNS topic with a Lambda subscription pointing at this function.
3. Lambda resource-based policy granting `sns.amazonaws.com` invoke from
   the topic ARN.

## IAM (Phase 5)

- DynamoDB:
  - `GetItem` on `PK=TICKET#<id>|SK=OWNER` (TicketOwner mapping).
  - `GetItem` on `PK=USER#<email>|SK=TICKET#<id>` (ticket row).
  - `UpdateItem` on `PK=USER#<email>|SK=TICKET#<id>` (state patch).
- S3: none.
- SES: none.
- KMS: none.
- CloudWatch Logs: default.
