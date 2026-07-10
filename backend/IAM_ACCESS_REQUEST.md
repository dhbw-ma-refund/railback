# IAM policy request for user `s241539` (RailBack deploy)

Ready-to-attach policy so the student can provision + operate the RailBack
Lambda stack in **eu-north-1** on account **502129302313**. Everything is scoped
to `railback*`-named resources and the one shared execution role, so it cannot
touch other students' functions or account-wide settings.

**How the prof attaches it:** IAM → Users → `s241539` → Add permissions →
Create inline policy → JSON → paste the block below → name it
`railback-deploy`. (Or make it a managed policy and attach it.)

Two variants below: **A (recommended)** uses per-Lambda **Function URLs** as the
public entrypoint (no API Gateway). **B** is the extra block if you'd rather use
a real API Gateway. Pick A unless you specifically want API Gateway.

---

## Policy A — Lambda + Function URLs (recommended, smaller surface)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaManageRailbackFunctions",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListVersionsByFunction",
        "lambda:PublishVersion",
        "lambda:TagResource",
        "lambda:CreateFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:GetPolicy",
        "lambda:CreateEventSourceMapping",
        "lambda:DeleteEventSourceMapping",
        "lambda:GetEventSourceMapping",
        "lambda:ListEventSourceMappings"
      ],
      "Resource": "arn:aws:lambda:eu-north-1:502129302313:function:railback-*"
    },
    {
      "Sid": "LambdaListAll",
      "Effect": "Allow",
      "Action": "lambda:ListFunctions",
      "Resource": "*"
    },
    {
      "Sid": "PassSharedExecutionRoleToLambda",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::502129302313:role/lambdaFunctionRole_students_eu-north-1",
      "Condition": {
        "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" }
      }
    },
    {
      "Sid": "EventBridgeCronForSweepers",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:DescribeRule",
        "events:ListTargetsByRule"
      ],
      "Resource": "arn:aws:events:eu-north-1:502129302313:rule/railback-*"
    },
    {
      "Sid": "SnsForSesEvents",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:Subscribe",
        "sns:GetTopicAttributes",
        "sns:SetTopicAttributes",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "arn:aws:sns:eu-north-1:502129302313:railback-*"
    },
    {
      "Sid": "S3NotificationOnBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketNotification",
        "s3:PutBucketNotification"
      ],
      "Resource": "arn:aws:s3:::RAILBACK_BUCKET_NAME"
    },
    {
      "Sid": "ReadOwnIamForDebug",
      "Effect": "Allow",
      "Action": [
        "iam:GetRole",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "arn:aws:iam::502129302313:role/lambdaFunctionRole_students_eu-north-1"
    }
  ]
}
```

> Replace `RAILBACK_BUCKET_NAME` with the actual bucket the prof created. If the
> bucket doesn't start with `railback`, that's fine — the S3 statement targets it
> by exact name, nothing else.

DynamoDB is intentionally **not** in this policy — the student already has DDB
access on the `RailBack` table (that's how `gsi3` was added). No change needed
there.

---

## Policy B — add this statement ONLY if using API Gateway instead of Function URLs

```json
{
  "Sid": "ApiGatewayHttpApi",
  "Effect": "Allow",
  "Action": [
    "apigateway:GET",
    "apigateway:POST",
    "apigateway:PUT",
    "apigateway:PATCH",
    "apigateway:DELETE"
  ],
  "Resource": "arn:aws:apigateway:eu-north-1::/apis*"
}
```

API Gateway's ARN model doesn't let you scope by name at create time (the API id
is assigned by AWS), so this grants management of HTTP/REST APIs in the region.
That's the one broad-ish grant — see risks. If the prof is uncomfortable with it,
use Policy A (Function URLs) and drop this block entirely.

---

## What each statement is for + its risk

| Sid | What it enables | Risk if abused / misused |
|---|---|---|
| **LambdaManageRailbackFunctions** | Create/update/delete the 8 `railback-*` functions, ship code, set env vars, add Function URLs, and let S3/SNS invoke them (`AddPermission`). The core of deploying. | Scoped to `railback-*` only — cannot touch other students' `s2xxxx` functions. Worst case: student breaks/deletes their own RailBack functions. Low blast radius. |
| **LambdaListAll** | `ListFunctions` (read-only). Needed because AWS doesn't allow scoping `ListFunctions` by name. | Read-only enumeration of function *names* in the account. No code/secret access. Minor info disclosure only. |
| **PassRole (shared role)** | Lets the student attach the existing `lambdaFunctionRole_students_eu-north-1` to the functions they create. Lambda requires `PassRole` to set an execution role. | Constrained by `iam:PassedToService=lambda` and to that one role only. Student cannot pass any other (e.g. admin) role. This is the standard, safe PassRole pattern. The functions get exactly the permissions that shared role already has — no privilege escalation beyond it. |
| **EventBridgeCronForSweepers** | Create the 5-min / daily cron rules that trigger `email-sweeper` + `anonymisation-sweeper`. Scoped to `railback-*` rules. | Can only create/delete `railback-*` rules. Worst case: a runaway cron invokes the student's own Lambda too often (cost) — but PAY_PER_REQUEST + tiny functions make this cents. |
| **SnsForSesEvents** | Create the SNS topic + subscription that carries SES delivery/bounce events to `email-webhook`. Scoped to `railback-*` topics. | Scoped by name. Can't read other topics. Low risk. |
| **S3NotificationOnBucket** | Configure the "on upload, invoke ticket-extractor" notification on the one project bucket. | Only `Get/PutBucketNotification` on that single bucket — **not** read/write of its objects, not other buckets. Worst case: student misconfigures the notification and extraction doesn't fire. No data exposure. |
| **ReadOwnIamForDebug** | Read the shared execution role's attached policies (so the student can see what their functions are allowed, for debugging). | Read-only, one role. No IAM write. Harmless. |
| **ApiGatewayHttpApi** (Policy B only) | Create/manage the HTTP API + routes. | **The broadest grant.** Can't be name-scoped (AWS limitation), so it covers all APIs in the region — a student could read/modify/delete *another* project's API Gateway if one exists. **Mitigation:** prefer Policy A (Function URLs) and omit this entirely. |

## What is deliberately NOT requested (and why that's good)

- **No `iam:CreateRole` / `AttachRolePolicy` / `PutRolePolicy`** — the student
  reuses the provided shared role via `PassRole`. No ability to mint new
  permissions = no privilege-escalation path.
- **No account-wide `lambda:*`** — everything is `railback-*`-scoped, so other
  students' functions are untouchable.
- **No S3 object read/write in this policy** — the *functions* get bucket access
  from their execution role at runtime; the *user* only configures the trigger.
- **No SES admin** (domain verification, production-access request stays with the
  prof) and **no DynamoDB changes** (already granted).

Net: this is a least-privilege, name-scoped deploy policy. The only line worth a
second look is the API Gateway block — and the recommended path avoids it.
