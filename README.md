# praxisproject

DynamoDB connector layer for RailBack. Single-table design on AWS DynamoDB (`eu-north-1`).

## Structure

```
db/
  base.py        # Result type (Ok/Err), @safe decorator, BaseConnector
  connector.py   # Entity connectors + RailBackConnector
unittests/       # Integration tests (pytest)
loadtests/       # Load tests (empty, ready for k6/locust)
```

## Requirements

- Python 3.13+
- [uv](https://github.com/astral-sh/uv)
- [Podman](https://podman.io) (for local testing)

## Running tests locally

Start DynamoDB Local:

```bash
podman run -d -p 8000:8000 amazon/dynamodb-local
```

Run the tests:

```bash
DYNAMODB_ENDPOINT_URL=http://localhost:8000 uv run pytest unittests/ -v
```

## Running tests against real AWS

Configure credentials:

```bash
aws configure  # region: eu-north-1
```

Run the tests:

```bash
uv run pytest unittests/ -v
```

## Connectors

| Connector | PK | SK |
|---|---|---|
| `user` | `USER#{email}` | `PROFILE` |
| `admin` | `ADMIN#{email}` | `PROFILE` |
| `ticket` | `USER#{email}` | `TICKET#{id}` |
| `ticket_owner` | `TICKET#{id}` | `OWNER` |
| `raw_upload` | `USER#{email}` | `RAW#{id}` |
| `rendered_pdf` | `USER#{email}` | `RENDERED#{id}` |
| `receipt` | `USER#{email}` | `TICKET#{id}#BELEG#{id}` |
| `mandate` | `USER#{email}` | `TICKET#{id}#MANDATE` |
| `sepa_report` | `SEPA#REPORT#{date}` | `REPORT#{id}` |
| `train_delay` | `TRAIN#{nr}#{date}` | `SEG#{id}` |
| `route_template` | `USER#{email}` | `TEMPLATE#{id}` |

GSIs: `gsi1` (user/admin/train lookups + station route lookup), `gsi2` (barcode dedup), `gsi_email_pending` (email queue).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DYNAMODB_ENDPOINT_URL` | _(none)_ | Set to `http://localhost:8000` for local DynamoDB |
| `RAILBACK_DDB_TABLE` | `RailBack` | DynamoDB table name |
