# user-handler — Build / Deploy

> **Phase 2.2 status (2026-06-23)**: this lambda is **test-only**, same
> story as auth-handler. Routes covered so far:
>
> - `GET /users/me`
> - `PATCH /users/me`
> - `GET /users/me/refund-data`
> - `PATCH /users/me/bank`
> - `DELETE /users/me`
>
> Phase 2.3 will add the ticket / refund / belege / route-template /
> route-lookup / from-route surfaces.
>
> Same deploy gap as auth-handler: production `handler.ts` calls `db()`
> from `@railback/lib/storage` but does NOT side-effect-register a
> backend. Tests work because `test/setup.ts` imports
> `@railback/mocks-in-memory`. Real Lambda cold-start would throw
> `ERR_INTERNAL "no factory registered"`. Resolution lands in Phase 5
> alongside the real DDB-side `lib/storage/ddb/` impls.

## Routes (Phase 2.2)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/users/me` | profile view, no IBAN/BIC |
| `PATCH` | `/users/me` | partial profile update (vorname, nachname, telefon, adresse). At least one field required; `adresse` is wholesale replace |
| `GET` | `/users/me/refund-data` | EU-form field set incl. decrypted IBAN/BIC |
| `PATCH` | `/users/me/bank` | IBAN + BIC together; mod-97 validated; re-encrypted before persist |
| `DELETE` | `/users/me` | requires `confirmPassword`; scrypt re-verify; suspended → 403; idempotent on already-DELETION_SCHEDULED |

All routes require a Bearer access token with `role=USER`. ADMIN tokens
get `ERR_FORBIDDEN` — admins use the separate admin-handler.

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_JWT_SECRET` — must match the value auth-handler uses
- `RAILBACK_JWT_ACCESS_TTL_SEC` — defaults to 900 (15 min)
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5)
- `RAILBACK_AWS_REGION` — required when `RAILBACK_STORAGE=ddb` (Phase 5)

The refresh-token TTL (`RAILBACK_JWT_REFRESH_TTL_SEC`) is only used by
auth-handler; not consumed here.

## Local dev

Tests run at root-level Vitest (per DECISIONS.md — there is no
per-workspace `test` script):

```
cd backend
npm install
RAILBACK_STORAGE=memory \
RAILBACK_JWT_SECRET=dev-secret \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
npx vitest run lambdas/user-handler
```

Drop the trailing path to run the whole suite (`npm test`), or pass
`--watch` for iterative dev.

Typecheck this workspace only:

```
npm run typecheck --workspace=@railback/lambdas-user-handler
```

## Zip (Phase 5)

Same convention as auth-handler. Single esbuild CJS bundle of
`src/handler.ts` with `@railback/lib` inlined.

## IAM

`user-handler` (part 1) needs:

- DynamoDB:
  - `GetItem` on `PK=USER#<email>|SK=PROFILE` (read for GET/PATCH/DELETE)
  - `UpdateItem` (or `PutItem` overlay) on the same key for PATCH and
    DELETE (the latter writes `user_state=DELETION_SCHEDULED` + `ttl`).
- KMS: none (env-var KEK).
- CloudWatch Logs: default.

Part 2 will add ticket / blob / mandate / route-template / delay
permissions when those routes land.
