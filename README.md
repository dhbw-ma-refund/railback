# RailBack — DynamoDB Connector Bundle

Single-table DynamoDB connector layer for RailBack, in two parallel
implementations (TypeScript + Python) against the same table design, plus the
rendered schema documentation.

```
node/           TypeScript connector + adapter + Jest tests
python/         Python connector + pytest suite + load tests
documentation/  Rendered schema (railback_schema.pdf) + Typst source
DB_SCHEMA.md    Canonical schema contract
```

## Prerequisites

- [Podman](https://podman.io) (or Docker) — for local DynamoDB
- Node.js 20+ and npm — for the TypeScript tests
- Python 3.13+ and [uv](https://github.com/astral-sh/uv) — for the Python tests + load tests

## 0. Configure

```bash
cp .env.example .env
# .env already carries the local-DynamoDB + read-path load-test values.
```

## 1. Start local DynamoDB

Both unit-test suites run against a local DynamoDB on port 8000:

```bash
podman run -d --name railback-ddb -p 8000:8000 \
    amazon/dynamodb-local:latest -jar DynamoDBLocal.jar -inMemory -sharedDb
```

## 2. Python unit tests

```bash
cd python
uv sync
DYNAMODB_ENDPOINT_URL=http://localhost:8000 uv run pytest tests/ -v
```

## 3. Node unit tests

```bash
cd node
npm install
DYNAMODB_ENDPOINT_URL=http://localhost:8000 npm test
```

(Integration suites that need LocalStack S3 skip themselves automatically when
`S3_ENDPOINT_URL` is unset — the core unit tests do not need S3.)

## 4. Read-path load test (live API, read-only, no AWS creds)

Measures which query patterns are expensive against the live table. Read-only —
creates and deletes nothing. Base URL + admin credentials load from `.env`.

```bash
cd python
uv run python loadtests/read_path.py --levels 1,2,3 --requests-per-level 10
```

Writes `read_path_<timestamp>.json` + `.md` (and a live `.log`) to `--out`.

> **⚠️ Warning — this hits a shared live backend.** The defaults are intentionally
> gentle. Raising `--levels` / `--requests-per-level` to large values drives real
> concurrent load at the live API and **can degrade or disrupt service for anyone
> currently using it**. Increase them only against a deployment you own and can
> afford to stress, and ramp up gradually.

## 5. Write-path load test (live API + AWS credentials) — optional

`loadtests/write_path.py` measures create + hard-delete throughput. It hits the
live API for creates and needs **real AWS credentials** (eu-north-1) for the
hard-delete cascade; its preflight aborts if credentials can't clean up. Not
required for the steps above. Plan-only, no creds, touches nothing:

```bash
cd python
uv run python loadtests/write_path.py --base "$RAILBACK_API_BASE" --dry-run
```
