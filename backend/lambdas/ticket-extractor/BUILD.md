# BUILD.md — ticket-extractor

Per RailBack convention each Lambda folder documents its own build + deploy
steps. This is a **Python 3.12 Lambda zip** (not a container, not ECR).
Trigger: S3 `ObjectCreated:*` on the `raw/` prefix of the storage bucket.

> **Phase 2.8 status: implemented + test-only.** IAM role, S3 event mapping
> and the actual `aws lambda update-function-code` call live in Phase 5
> (deploy-gap). The zip step below produces an artefact that's ready to
> upload, but no AWS-side glue is in place yet.

## Prerequisites

- Python 3.12 (uv will download a managed interpreter on first run if missing)
- [uv](https://github.com/astral-sh/uv): `curl -LsSf https://astral.sh/uv/install.sh | sh`

## Install + test

```bash
cd railback/backend/lambdas/ticket-extractor
uv sync                  # creates .venv with runtime + dev deps
uv run pytest -v         # green = ready
```

`uv` reads `.python-version` (3.12). Tests use `moto` for S3 + DynamoDB
mocks — no real AWS calls happen.

## Build the deploy zip

Lambda zips bundle the source plus the dependency tree. We sync the
runtime-only graph (no dev deps) into a **separate** build-only venv
via `UV_PROJECT_ENVIRONMENT` so the project's working `.venv` (which
has pytest / moto in dev-deps) is left untouched. Then we zip `src/`,
`vendor/` and the `site-packages/` payload at the archive root so
`import boto3`, `import zxingcpp` etc. resolve against the bundled
libs.

```bash
# 1. fresh runtime-only sync into a dedicated build venv
rm -rf .build .venv-build
UV_PROJECT_ENVIRONMENT=.venv-build uv sync \
  --no-dev --frozen --no-install-project \
  --python 3.12 --python-preference managed

# 2. assemble the zip
mkdir -p .build
cp -r src vendor .build/
cp -r .venv-build/lib/python3.12/site-packages/* .build/
( cd .build && zip -r -X ../ticket-extractor.zip . )
```

After zipping, the project's `.venv` (dev deps) is still intact —
`uv run pytest` continues to work without a follow-up `uv sync`. If
you ever do clobber the dev venv (e.g. by running `uv sync --no-dev`
without setting `UV_PROJECT_ENVIRONMENT`), recover with a plain
`uv sync` to re-install pytest/moto.

Upload `ticket-extractor.zip` via AWS Console → Lambda → Upload from zip.
Handler entry-point: `src.handler.lambda_handler`.

## Runtime configuration

Env vars expected by the Lambda:

| Name | Purpose |
|---|---|
| `RAILBACK_DDB_TABLE` | DynamoDB table (default `railback` in tests) |
| `AWS_REGION` | `eu-north-1` (matches the rest of the stack) |

## IAM policy stub (Phase 5)

Minimum permissions the Lambda role needs. Locked here so the deploy
phase can copy-paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadRawUploads",
      "Effect": "Allow",
      "Action": ["s3:GetObject"],
      "Resource": "arn:aws:s3:::<bucket>/raw/*"
    },
    {
      "Sid": "ReadTicketOwnerAndUpdateUserTicket",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:eu-north-1:<acct>:table/railback"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

Note: `s3:GetObject` is prefix-pinned to `raw/*` — the Lambda must never
read rendered EU-form PDFs, belege, or pain.008 audit XML. That's the
"confused-deputy on IAM-prefix-pinned keys" defence the handler then
verifies a second time by hashing the owner-row email and matching it to
the key's email-hash segment.

## Vendored code

`vendor/onlineticket.py` is GPLv3 (rumpeltux/onlineticket). The licence
file (`vendor/LICENSE.onlineticket`) and our usage notes
(`vendor/THIRD_PARTY_LICENSES.md`) ship inside the zip. Do not modify the
vendored file in-place; if a patch is needed, document it in
`THIRD_PARTY_LICENSES.md` first.

## Updating

After editing source:

```bash
uv run pytest -v
# rebuild the zip with the steps above and re-upload via Console
```

After changing dependencies in `pyproject.toml`:

```bash
uv lock           # regenerate uv.lock, commit it
uv sync           # update local .venv
uv run pytest -v
```
