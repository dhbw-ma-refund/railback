# Build & Deploy

Each lambda owns a `BUILD.md` under its dir documenting the exact zip steps for
its runtime. The two scripts below automate the whole set.

## Build all zips

`scripts/build-lambdas.sh` bundles every deployable lambda into
`backend/dist-lambdas/<name>.zip` (gitignored, reproducible, offline).

```bash
scripts/build-lambdas.sh                 # all lambdas
scripts/build-lambdas.sh user-handler    # a subset
SKIP_PYTHON=1 scripts/build-lambdas.sh   # node only (no uv needed)
```

Node lambdas are esbuild CJS bundles (`@railback/lib` inlined; the AWS SDK v3
clients the Node 20 runtime ships are marked external). ticket-extractor
(Python) builds via `uv` per its own BUILD.md.

### Merged lambdas (locked 2026-07-09)

`refund-pdf` and `pain008-generator` are **not standalone AWS functions**. They
are library modules bundled INTO their callers via in-process dynamic imports:

- `refund-pdf` → bundled into **user-handler** (its PDF template ships in the
  user-handler zip under `assets/`).
- `pain008-generator` → bundled into **admin-handler**.

So there are **8 deployable functions**: admin-handler, anonymisation-sweeper,
auth-handler, email-sweeper, email-webhook, sepa-reports, user-handler (Node) +
ticket-extractor (Python).

## Deploy (controlled, manual)

`scripts/deploy.sh` is the controlled trigger — **not** wired to git push. It
uses your AWS CLI credentials and only runs `aws lambda update-function-code`
(ships code; does not create functions, set env, or wire triggers).

```bash
scripts/deploy.sh                    # typecheck + test + build + confirm + deploy ALL
scripts/deploy.sh user-handler       # one function
scripts/deploy.sh --dry-run          # build + show plan, no AWS calls
scripts/deploy.sh --no-check --yes user-handler   # skip tests + confirmation
```

Function-name mapping: logical name → `railback-<name>` by default. Override
the prefix with `RAILBACK_FN_PREFIX`, region with `RAILBACK_DEPLOY_REGION`
(default `eu-north-1`), or a single function with e.g.
`RAILBACK_FN_user_handler=my-fn`.

## One-time provisioning (not scripted)

Functions, env vars, IAM roles, API Gateway routes, S3 event triggers,
EventBridge crons, and SNS subscriptions are wired once via console/CLI — see
`../PHASE_3C-6_HANDOFF.md` for the ordered runbook, `../CLAUDE.md` for the full
env-var list, and `../ARCHITECTURE.md` for which lambda owns which trigger.
Env vars every function needs: `RAILBACK_STORAGE=ddb`, `RAILBACK_IBAN_KEK`,
`RAILBACK_DDB_TABLE`, `RAILBACK_S3_BUCKET`; plus SES/SEPA vars where relevant.
