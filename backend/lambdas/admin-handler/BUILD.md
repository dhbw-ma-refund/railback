# admin-handler — Build / Deploy

> **Phase 2.4 status (2026-06-25)**: this lambda is **test-only**, same
> story as auth-handler and user-handler. Routes covered:
>
> - `GET    /admin/stats`
> - `GET    /admin/users`
> - `GET    /admin/users/{email}`
> - `PATCH  /admin/users/{email}`
> - `GET    /admin/tickets`
> - `GET    /admin/tickets/{ticketId}`
> - `PATCH  /admin/tickets/{ticketId}`
> - `GET    /admin/trains/{trainNr}/{date}/delays`
> - `GET    /admin/sepa/pending-batches`
> - `POST   /admin/sepa/batches/{batchId}/mark-submitted`
> - `POST   /admin/sepa/reports/upload`
>
> Same deploy gap as the other lambdas: production `handler.ts` calls
> `db()` from `@railback/lib/storage` but does NOT side-effect-register a
> backend. Tests work because `test/setup.ts` imports
> `@railback/mocks-in-memory`. Real Lambda cold-start would throw
> `ERR_INTERNAL "no factory registered"`. Resolution lands in Phase 5
> alongside the real DDB-side `lib/storage/ddb/` impls.
>
> The pain008-generator Lambda sync-invoke wired into the
> `PENDING_DB_PAYMENT → APPROVED` transition is **deferred to Phase 2.9**;
> a clearly-marked TODO sits in `routes/patch-ticket.ts` until that lambda
> lands. The state transition itself happens today.

## Routes (Phase 2.4)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/stats` | KPI snapshot, lazy compute + 30 s in-process cache |
| `GET` | `/admin/users` | email-prefix + user_state filter, cursor-paged |
| `GET` | `/admin/users/{email}` | single user + recent_tickets (max 10) |
| `PATCH` | `/admin/users/{email}` | profile + user_state transitions (see state machine) |
| `GET` | `/admin/tickets` | state/email/trainNr/date/from/to filters, cursor-paged |
| `GET` | `/admin/tickets/{ticketId}` | full ticket + sepa_mandate block |
| `PATCH` | `/admin/tickets/{ticketId}` | ticket_state + db_paid_at + admin_note |
| `GET` | `/admin/trains/{trainNr}/{date}/delays` | segment delays passthrough |
| `GET` | `/admin/sepa/pending-batches` | pending pain.008 batches with presigned GET URLs |
| `POST` | `/admin/sepa/batches/{batchId}/mark-submitted` | flip every mandate in batch to SUBMITTED |
| `POST` | `/admin/sepa/reports/upload` | presigned POST for pain.002 / camt XML |

All routes require a Bearer access token with `role=ADMIN`. USER tokens
get `ERR_FORBIDDEN`.

## IBAN / BIC are never returned

`iban_enc` / `bic_enc` are stripped at the projection layer in
`src/projections.ts`. Adding a new admin-facing field that includes any
bank data is a deliberate violation of the data-minimisation contract —
see `CLAUDE.md` "Privacy / admin visibility".

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_JWT_SECRET` — must match the auth-handler value
- `RAILBACK_JWT_ACCESS_TTL_SEC` — defaults to 900 (15 min)
- `RAILBACK_IBAN_KEK` — present so cascading imports of @railback/lib/crypto/iban
  don't blow up (admin-handler itself never decrypts)
- `RAILBACK_S3_BUCKET` — required for `presignGet` / `presignPost` URLs
- `RAILBACK_AWS_REGION` — required for the S3 client
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5)

## Local dev

```
cd backend
npm install
RAILBACK_STORAGE=memory \
RAILBACK_JWT_SECRET=dev-secret \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
RAILBACK_S3_BUCKET=railback-storage \
RAILBACK_AWS_REGION=eu-central-1 \
npx vitest run lambdas/admin-handler
```

Typecheck only this workspace:

```
npm run typecheck --workspace=@railback/lambdas-admin-handler
```

## Zip (Phase 5)

Same convention as auth-handler / user-handler. Single esbuild CJS
bundle of `src/handler.ts` with `@railback/lib` inlined.

## IAM

- DynamoDB:
  - `GetItem`, `Query`, `Scan` on the main table (lazy stats + admin lists)
  - `UpdateItem` on `PK=USER#<email>|SK=PROFILE` (PATCH user)
  - `UpdateItem` on `PK=USER#<email>|SK=TICKET#<id>` (PATCH ticket)
  - `UpdateItem` on `PK=USER#<email>|SK=TICKET#<id>#MANDATE` (mark-submitted)
- S3:
  - `s3:GetObject` on `pain008/*` (presigned-GET source for download URLs)
  - presigned POST policies for `sepa-reports/*`
- Lambda (Phase 2.9 follow-up): `lambda:InvokeFunction` on
  `pain008-generator` once the sync-invoke lands.
- KMS: none (env-var KEK, only used by /users/me/refund-data via user-handler).
- CloudWatch Logs: default.
