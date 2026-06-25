# Build

This file is a placeholder. Each lambda owns its own `BUILD.md` under its
lambda dir (e.g. `backend/lambdas/auth-handler/BUILD.md`,
`backend/lambdas/ticket-extractor/BUILD.md`) documenting the exact zip steps
for that runtime — Node bundles via esbuild, Python lambdas via `pip install
-t` into the package dir.

## Helper

`backend/scripts/zip-lambda.sh` is the intended single entrypoint that wraps
bundle + zip per lambda. **It does not exist yet — Phase 5.** Until then,
follow each lambda's `BUILD.md` by hand. The helper will not change the
output shape, only automate it.

## Deploy

No IaC. The deploy path is: build the zip, open the AWS Console, upload to
the lambda manually. Env vars (`RAILBACK_STORAGE=ddb`, `RAILBACK_IBAN_KEK`,
`RAILBACK_SES_FROM_ADDRESS`, `RAILBACK_SES_CONFIGURATION_SET`,
`RAILBACK_SEPA_*`, etc.) are set in the Console too. API Gateway routes,
S3 event triggers, EventBridge crons, and SNS subscriptions are wired by
hand once per lambda. See `../CLAUDE.md` for the full env-var list and
`../ARCHITECTURE.md` for which lambda owns which trigger.
