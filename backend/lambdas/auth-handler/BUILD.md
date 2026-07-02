# auth-handler — Build / Deploy

> **Phase 2.1 status (2026-06-21)**: this lambda is **test-only**. Both the
> "memory" and "ddb" storage backends are gated behind unimplemented
> wiring:
>
> - **`memory`** works in `vitest` because `test/setup.ts` explicitly
>   imports `@railback/mocks-in-memory`, which side-effect-registers
>   itself with `@railback/lib/storage`. The production `handler.ts`
>   doesn't do this import — calling `db()` at cold-start would throw
>   `ERR_INTERNAL "no factory registered for memory"`.
> - **`ddb`** is wired through `@railback/lib/storage/ddb/stubs.ts`,
>   whose `DdbUserRepo` / `DdbAdminRepo` methods throw
>   `ERR_INTERNAL "DDB backend deferred to Phase 5"`. The S3-backed
>   `BlobRepo` is real (since `blob-repo.ts`), but the auth-handler
>   doesn't touch blobs, so even that doesn't help here.
>
> Real deploy needs **Phase 5**:
> 1. Implement `lib/src/storage/ddb/{users,admins,...}.ts` with real
>    `DynamoDBDocumentClient` calls.
> 2. Add a `bootstrap.ts` to this lambda that, before the first
>    `handler()` invocation, imports the appropriate storage factory based
>    on `RAILBACK_STORAGE` and calls `registerBackend()`. (Side-effect
>    import of `@railback/mocks-in-memory` for `memory`; new
>    `@railback/lib/storage/ddb/index` for `ddb`.)
> 3. Update this BUILD.md to point at the new bootstrap.
>
> Until then: the route logic is fully tested, but `npx lambda local`
> against this handler will fail. Use the integration test harness in
> `lambdas/auth-handler/test/` to exercise it.

## Routes

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`

## Runtime env

- `RAILBACK_STORAGE` — `memory` for local/dev, `ddb` on Lambda
- `RAILBACK_JWT_SECRET` — HS256 signing secret (any random ≥32-byte string)
- `RAILBACK_JWT_ACCESS_TTL_SEC` — defaults to 900 (15 min)
- `RAILBACK_JWT_REFRESH_TTL_SEC` — defaults to 2,592,000 (30 days)
- `RAILBACK_IBAN_KEK` — AES-256-GCM master key, base64 of 32 bytes
- `RAILBACK_DDB_TABLE` — required when `RAILBACK_STORAGE=ddb` (Phase 5)
- `RAILBACK_AWS_REGION` — required when `RAILBACK_STORAGE=ddb` (Phase 5)

## Local dev

```
cd backend
npm install
RAILBACK_STORAGE=memory \
RAILBACK_JWT_SECRET=dev-secret \
RAILBACK_IBAN_KEK=$(node -e "console.log(Buffer.alloc(32,0x42).toString('base64'))") \
npx vitest run lambdas/auth-handler
```

(Drop the trailing path for the whole suite, or use `--watch` for
iterative dev. There is no per-workspace `test` script — vitest runs
at root level per DECISIONS.md.)

## Zip (Phase 5)

Manual zip step is owned by `backend/scripts/zip-lambda.sh` (deferred to
Phase 5). The intended layout inside the zip:

```
auth-handler.zip
├── handler.js         # esbuild bundle of src/handler.ts, with @railback/lib inlined
└── package.json       # minimal — runtime needs no native modules
```

Bundle command (Phase 5 will codify):
```
npx esbuild lambdas/auth-handler/src/handler.ts \
  --bundle --platform=node --target=node20 \
  --format=cjs --outfile=dist/handler.js
```

Why CJS bundle for the Lambda even though the workspace is ESM:
- AWS Lambda's Node 20 runtime supports ESM but requires `.mjs` or
  `"type":"module"` in `package.json` next to the handler. Bundling to
  CJS keeps the deployable artefact a single file with no
  package.json-in-zip ceremony.
- The TypeScript sources stay ESM (`type:module` in workspaces); the
  bundle is the only place we cross the boundary.

## IAM

`auth-handler` needs:

- DynamoDB: `GetItem` on `PK=USER#<email>|SK=PROFILE` and
  `PK=ADMIN#<email>|SK=PROFILE`. `PutItem` on `PK=USER#<email>|SK=PROFILE`
  (register only).
- KMS: none (KEK is env-var, AWS-managed encryption at rest on the
  Lambda's env-var store is enough).
- CloudWatch Logs: default `lambda:CreateLogStream` + `PutLogEvents`.

No S3, no SES, no SNS — this lambda only mints tokens. The other
lambdas own bytes / email / state-machine transitions.
