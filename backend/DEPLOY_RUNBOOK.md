# RailBack — Deployment Runbook (for someone new to AWS)

This is a step-by-step guide to get RailBack live on AWS in **eu-north-1**.
It assumes zero prior AWS experience. Read the "Mental model" first.

Everything lives in region **eu-north-1** (Stockholm). Do not mix regions.

---

## Known environment (confirmed 2026-07-10)

Concrete facts discovered against the real account — use these exact values.

- **AWS profile:** credentials live under a named profile `railback` in
  `~/.aws/`, NOT `default`. Run `export AWS_PROFILE=railback` in your shell
  (or add it to `~/.zshrc`) so plain `aws ...` and `scripts/deploy.sh` pick
  them up. Verify: `aws sts get-caller-identity` → account `502129302313`,
  user `s241539`.
- **Your access is scoped to eu-north-1 only** (other regions return
  AccessDenied). Fine — everything is in eu-north-1.
- **DynamoDB table name is `RailBack`** (capital R, capital B) — case matters.
  Set `RAILBACK_DDB_TABLE=RailBack` everywhere. Keys `pk`/`sk`.
- **GSIs:** all four now present — `gsi1`, `gsi2`, `gsi_email_pending`, `gsi3`.
  `gsi3` was added 2026-07-10 (`aws dynamodb update-table`, keys
  `gsi3_pk`/`gsi3_sk`, projection ALL) — the route-lookup/delay feature needs
  it. You have `UpdateTable` rights.
- **Confirmed rights (probed 2026-07-10):**
  - DynamoDB: describe / list / update-table in eu-north-1 — ✅
  - Lambda: on ONE pre-created function `s241539` you can
    `update-function-code`, `update-function-configuration`, change runtime
    (→ `nodejs20.x`), handler, and env vars — ✅
  - That function has a public **Function URL** (auth NONE, CORS `*`):
    `https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws/`
  - Shared execution role provided: `lambdaFunctionRole_students_eu-north-1`
  - **DENIED:** `lambda:CreateFunction`, all of API Gateway
    (`apigateway:GET`), IAM create/read (`iam:GetRole`, `ListPolicies`, …)
- **THIS IS A LOCKED STUDENT SANDBOX.** The account gives each student exactly
  one Lambda (named after their matriculation number) + a Function URL. You
  **cannot** create the 8 separate functions, the API Gateway, or the
  S3/SNS/EventBridge triggers the architecture assumes. **The provisioning
  steps below are NOT executable at this access level.** Two ways forward:
  1. **Request more access** (see below) to match the multi-Lambda design, or
  2. **Collapse to a single-Lambda monolith** on `s241539` (its Function URL
     replaces API Gateway; handlers already self-route, so one dispatcher can
     serve `/auth`, `/users`, `/admin`). Event-driven pieces (extractor on
     upload, email/anonymisation crons) then need manual/inline triggering.

### Access to request from the professor (be specific — "more access" is too vague)

To run the multi-Lambda architecture as designed, ask for these actions in
**eu-north-1**, scoped to `railback*`-named resources if he wants to limit blast
radius:

- `lambda:CreateFunction`, `DeleteFunction`, `AddPermission`,
  `CreateEventSourceMapping`, `GetFunction*` (create the 8 functions + let S3/SNS invoke them)
- `iam:PassRole` on `lambdaFunctionRole_students_eu-north-1` (attach the shared
  role to new functions) — or a dedicated `railback-lambda-role`
- API Gateway: `apigateway:*` (create the HTTP API + routes) — OR skip API
  Gateway entirely and use per-function Function URLs (`lambda:CreateFunctionUrlConfig`)
- `events:PutRule`, `PutTargets` (EventBridge crons for the sweepers)
- `sns:CreateTopic`, `Subscribe` + SES event-destination rights (email-webhook)
- S3: `PutBucketNotification` on the bucket (trigger ticket-extractor on upload)

If he declines any of these, fall back to the single-Lambda monolith (option 2
above) — it needs no new permissions beyond what you already have.

---

## Mental model — what "deploy" means here

There are two separate jobs. Don't confuse them.

- **Provisioning (one-time):** *creating* the cloud resources — the database
  table, the file bucket, the functions, the public URL, the permissions.
  Done once. Needs broad rights.
- **Shipping code (repeatable):** uploading new code into functions that
  already exist. Done every time you change code. `scripts/deploy.sh` does this.
  Needs only narrow rights.

RailBack is made of small programs called **Lambda functions** (8 of them).
Three of them answer web requests (auth, user, admin); the other five run on
triggers (a file upload, a timer, an email event). Only the three web-facing
ones sit behind the public URL.

Pieces and who owns them:

| Piece | What it is | Who creates it |
|---|---|---|
| **DynamoDB table** `RailBack` | the database (one table, 4 indexes) | **you** — script provided |
| **S3 bucket** | file storage (uploads, PDFs) | **prof** |
| **SES** | sends the refund emails | **prof** (domain + creds) |
| **8 Lambda functions** | the actual code | **you** |
| **API Gateway** | turns 3 Lambdas into one public https URL | **you** — see below |
| **IAM roles** | permissions each Lambda has | **you** (one shared role is fine for a demo) |
| **SNS topic + EventBridge rules** | wiring for email events + timers | **you**, last (optional for a first demo) |

---

## What you need from the professor (ask now — you're blocked without these)

1. **AWS credentials for you.** Either:
   - an **IAM user** with an access key (`aws configure` with it), OR
   - **AWS SSO / IAM Identity Center** login (`aws configure sso`).

   Ask for permissions to: **Lambda (full), DynamoDB (full), API Gateway
   (full), IAM (create roles + attach policies), CloudWatch Logs**. Say you're
   a student deploying a university project and need to create functions + an
   API. If he'll only give narrow rights, see "Minimal rights fallback" below.

2. **The S3 bucket name** he created (e.g. `railback-storage`), in eu-north-1.

3. **The SES setup:** the verified sender address (e.g.
   `noreply@<his-domain>`) and confirmation that SES is **out of sandbox**
   (otherwise it only mails pre-approved addresses — fine for a demo to
   yourselves, a problem for arbitrary recipients).

4. **The 32-byte encryption key** (`RAILBACK_IBAN_KEK`) — one base64 string
   shared by all Lambdas. If it doesn't exist yet, generate one (below) and
   tell the prof; it must be identical everywhere or IBAN decryption breaks.

Verify your credentials work before anything else:

```bash
aws sts get-caller-identity        # must print an account/user, not "NoCredentials"
aws configure set region eu-north-1
```

---

## Answer: what does API Gateway need?

API Gateway is the front door — it gives you one public https URL and forwards
requests to your Lambdas. **Use "HTTP API" (v2), not "REST API"** — it's
cheaper, simpler, and it's the event format the handlers already expect
(`event.requestContext.http.path`).

The important simplification: **each handler routes itself internally.**
`user-handler` looks at the path and decides what to do. So you do **not**
create a route per endpoint. You create **3 catch-all routes**, one per
web-facing Lambda:

| Route (method + path) | Integration (target Lambda) |
|---|---|
| `ANY /auth/{proxy+}`  | auth-handler  |
| `ANY /users/{proxy+}` | user-handler  |
| `ANY /admin/{proxy+}` | admin-handler |

`{proxy+}` means "match everything under this prefix." `ANY` means all HTTP
methods. That's the whole API surface.

**Auth:** the handlers verify the JWT themselves (custom HS256), so you do NOT
need an API Gateway JWT authorizer. Leave routes open at the gateway; the code
rejects bad tokens. (Simpler and matches how tests run.)

You can build this in the console (API Gateway → Create API → HTTP API → add
the 3 integrations + routes) or via CLI — a script is in "Provisioning steps"
below.

---

## Provisioning steps (in order)

Do these once. Commands assume `aws` is configured for eu-north-1 and you're
in the repo root.

### 0. Generate the encryption key (if the prof hasn't)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Save the output. This is `RAILBACK_IBAN_KEK`. Same value on every Lambda.

### 1. Create the DynamoDB table (script provided)

```bash
cd railback-db/node
npm install
RAILBACK_DDB_TABLE=RailBack RAILBACK_DDB_REGION=eu-north-1 \
  node scripts/create-ddb-table.mjs
```

(Leave `DYNAMODB_ENDPOINT_URL` unset so it hits real AWS.) This creates the
table with all four indexes. Verify in the console: DynamoDB → Tables →
`RailBack` → Indexes shows `gsi1`, `gsi2`, `gsi_email_pending`, `gsi3`.

### 2. Confirm the S3 bucket exists (prof made it)

```bash
aws s3 ls s3://<bucket-name>       # should not error
```

### 3. Create one IAM role for the Lambdas

For a demo, a single shared role with these AWS-managed-ish permissions is
fine (tighten later): DynamoDB access to the `RailBack` table, S3 access to
the bucket, SES send, CloudWatch Logs. In the console: IAM → Roles → Create
role → trusted entity "AWS service: Lambda" → attach `AmazonDynamoDBFullAccess`,
`AmazonS3FullAccess`, `AmazonSESFullAccess`, `CloudWatchLogsFullAccess`
(coarse but demo-acceptable). Name it `railback-lambda-role`. Copy its ARN.

### 4. Create the 8 Lambda functions (empty shells, then ship code)

For each function: runtime, handler entry, role, env vars. The 7 Node ones use
runtime **nodejs20.x**, handler **`index.handler`**. The Python one uses
**python3.12**, handler **`src.handler.lambda_handler`**.

Functions (name them `railback-<x>` to match `deploy.sh`'s default):

- `railback-auth-handler`, `railback-user-handler`, `railback-admin-handler`
  (web-facing)
- `railback-email-sweeper`, `railback-email-webhook`,
  `railback-sepa-reports`, `railback-anonymisation-sweeper` (event-driven)
- `railback-ticket-extractor` (Python, event-driven)

Create each in the console (Lambda → Create function → Author from scratch),
or with the CLI once you have a first zip built:

```bash
cd railback/backend
scripts/build-lambdas.sh                 # produces dist-lambdas/*.zip

# example: create one function (repeat per function, adjusting name/runtime/handler)
aws lambda create-function \
  --region eu-north-1 \
  --function-name railback-user-handler \
  --runtime nodejs20.x --handler index.handler \
  --role arn:aws:iam::<acct-id>:role/railback-lambda-role \
  --timeout 30 --memory-size 512 \
  --zip-file fileb://dist-lambdas/user-handler.zip
```

Set env vars on every function (Lambda → Configuration → Environment variables,
or `aws lambda update-function-configuration --environment ...`):

```
RAILBACK_STORAGE=ddb
RAILBACK_DDB_TABLE=RailBack
RAILBACK_S3_BUCKET=<bucket-name>
RAILBACK_IBAN_KEK=<the base64 key>
RAILBACK_AWS_REGION=eu-north-1
RAILBACK_JWT_SECRET=<a long random string, same on all>
RAILBACK_SES_FROM_ADDRESS=noreply@<prof-domain>     # on the mail-sending ones
```

(`RAILBACK_ANONYMISATION_DRY_RUN` — leave unset/true at first; flip to `false`
only after you've seen a dry-run log.)

### 5. Wire API Gateway (the public URL)

Console path: API Gateway → Create API → **HTTP API** → Add integrations
(Lambda: pick auth-handler, user-handler, admin-handler) → Add the 3 routes
from the table above → deploy to a stage (call it `$default`). It gives you an
**Invoke URL** like `https://abc123.execute-api.eu-north-1.amazonaws.com`.

That URL + `/auth/login`, `/users/me`, etc. is what the frontend calls.

### 6. Wire the event-driven Lambdas (do last; skippable for a first smoke test)

- **ticket-extractor:** S3 → your bucket → Properties → Event notifications →
  on `PutObject` under prefix `raw/` → target `railback-ticket-extractor`.
- **email-webhook:** SES → Configuration Set → event destination → SNS topic →
  subscribe `railback-email-webhook` to that topic.
- **email-sweeper / anonymisation-sweeper:** EventBridge → Schedule → rate
  (5 min / 1 day) → target the function.
- **sepa-reports:** S3 event on prefix `sepa-reports/` → the function.

---

## After provisioning: shipping code updates (your day-to-day)

Once the functions exist, every code change ships with:

```bash
cd railback/backend
scripts/deploy.sh                 # typecheck + test + build + confirm + upload ALL
scripts/deploy.sh user-handler    # just one
scripts/deploy.sh --dry-run       # see the plan, no upload
```

This only needs `lambda:UpdateFunctionCode` rights — narrow, safe.

---

## First smoke test (prove it's alive)

1. Seed one admin + one user into the real table:
   ```bash
   cd railback/backend
   RAILBACK_IBAN_KEK=<key> RAILBACK_DDB_TABLE=RailBack RAILBACK_DDB_REGION=eu-north-1 \
     npx tsx scripts/seed-ddb.ts
   ```
2. Hit the API:
   ```bash
   curl -X POST https://<invoke-url>/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"<seeded-user>","password":"<seeded-pw>"}'
   ```
   A JSON body with an `accessToken` = the whole chain (API GW → Lambda → DDB)
   works.
3. In the Lambda console, each function has a **Test** button + **CloudWatch
   Logs** — that's where you debug cold-start crashes.

---

## Minimal rights fallback (if the prof won't grant broad access)

If you can only get `lambda:UpdateFunctionCode`, then **you can't provision** —
hand the prof (or whoever has admin) this document and ask them to do steps
1–6. Your job then is only `scripts/deploy.sh`. The build script produces the
exact zips they upload if they'd rather click.

---

## Known caveats (already flagged, not blockers to provisioning)

- **SES sandbox:** until the prof takes SES out of sandbox, email only reaches
  pre-verified addresses. Fine for a demo to your own inboxes.
- **Zeitkarte refund amount** uses placeholder values (5/10 EUR) pending the
  DB-AGB table — see `compute-fee.ts`. Redeploy `railback-user-handler` when
  real numbers land.
- Region is **eu-north-1** everywhere. If any resource ends up in another
  region, cross-region calls will fail or be slow.
