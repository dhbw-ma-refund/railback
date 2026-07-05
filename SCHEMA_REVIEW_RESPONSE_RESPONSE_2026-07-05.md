# RailBack DB Layer — Response to the Response (2026-07-05)

Response to `SCHEMA_REVIEW_RESPONSE_2026-07-05.md`. Called
"response_response" because it is.

Structure below matches the section numbering from the two prior docs.

---

## §1 Integration model — agreed, locked

Option C confirmed. Same-table, two parallel codebases: Python connector
for Python Lambdas, backend writes its own TypeScript DDB impl for Node
Lambdas. Both sides converge on the shared physical schema.

Locked on our side in `DECISIONS.md` today.

`DB_SCHEMA.md` (in `projektmanagement/`) is the shared arbiter: when the
two codebases disagree, the schema doc wins and whoever drifted fixes
it. New entities / indexes / attribute renames land in both codebases in
the same PR window, not one-then-the-other.

---

## §2 Attribute-name case — agreed, we move

Point taken about the connector being the abstraction boundary. We are
moving our side to lowercase.

Concretely on backend side:
- `lib/src/storage/ddb/*` marshals TS-uppercase types ↔ DDB-lowercase
  attributes at the wire boundary. Nothing above the marshal layer needs
  to know about the physical names.
- GSI names lowercase: `gsi1`, `gsi2`, `gsi3`, `gsi_email_pending`.
- If the marshal layer turns out to be more friction than value, we may
  rename the TS `Item` interfaces in `items.ts` to lowercase too — that
  is our internal call, no wire impact either way.

Locked on our side in `DECISIONS.md` today. No further action from you.

---

## §3 GSI3 vs GSI1 — your call, and yes on the tiebreaker

Overloading GSI1 is fine on our end. You own that decision, we do not
need to see it. Consolidating one GSI, saving one write-amplification
step per Put — good outcome.

**On the tiebreaker: yes, we need one, and multiple results are the
expected shape.**

Same-minute same-station collisions are a real case in the source data,
not a corner case:

- **Different train categories from the same station at the same
  HH:MM** — an ICE and an RE can both be timetabled to depart Frankfurt
  Hbf at 08:00. Different platforms, different physical trains, both
  real rows.
- **`piebro/deutsche-bahn-data`** (our cold-tail source per
  `INGEST_DELAYS.md`) has **minute resolution**, not seconds. Even
  trains that in reality depart at 08:00:15 and 08:00:45 both land as
  `08:00`.
- **The `/fchg` poller** (Iris hot tail): same minute resolution.

So multiple rows returning for the same station and minute is not a
bug — it is the correct shape. The route-lookup Lambda's job is
downstream: it renders every candidate direct-connection in the time
window so the user picks their actual train
(`ICE 599 08:00 → RE 60 08:00`, the frontend shows both).

What we do want is **deterministic ordering** so results are stable
across page-loads and tests. Concretely: extend the SK with the train
number as tiebreaker:

```
gsi1_sk = "<HH:MM>#<trainNr>"     e.g.  "08:00#ICE599"
```

`BETWEEN("08:00", "08:59")` still returns both rows (string comparison
sees `08:00#ICE599` and `08:00#RE60` both `>= "08:00"` and
`<= "08:59￿"`). Order becomes lexicographic on `HH:MM` first, then
train number — stable, no rows silently collapsed.

If you ever need finer-than-minute resolution later, `HH:MM:SS#<trainNr>`
extends cleanly.

**Action for you:** add trainNr suffix to `TrainSegmentDelayConnector`'s
GSI1_SK writes. No change to the `BETWEEN` query in `route_lookup`
itself.

---

## §4 Email-pending GSI — full spec

Fair pushback. Here is the full picture:

### 4.1 What goes into the GSI

The **Lambda that transitions a ticket into `email_status IN
("SENDING", "FAILED_TRANSIENT")`** writes the GSI keys onto the ticket
row. Two callers:

- **`refund-pdf`** on initial send. Flow: after rendering the EU-form
  PDF, calls SES `SendEmailCommand` inline. If SES returns 2xx →
  `email_status="SENT"`, GSI keys stay unset. If SES fails (non-2xx or
  network error) and `email_attempts < 3` → sets
  `email_status="FAILED_TRANSIENT"`, `email_attempts=1`,
  `email_last_attempt=<now-iso>`, and writes the GSI keys.
- **`email-sweeper`** on cron retries. Reads the GSI (oldest first, see
  4.4 below), re-sends via SES, bumps `email_attempts`, refreshes
  `email_last_attempt`, refreshes `gsi_email_pending_sk` to the new
  timestamp so the ticket re-enters the queue at the tail.

### 4.2 What the SK contains

**ISO-8601 UTC timestamp** matching `email_last_attempt`. Exact format:

```
gsi_email_pending_sk = "2026-07-05T12:34:56.789Z"
```

Millisecond precision, `Z` suffix. Node side generates it with
`new Date().toISOString()`. Python side (if you ever write to this
GSI) generates it with `datetime.now(timezone.utc).isoformat(
timespec="milliseconds").replace("+00:00", "Z")`.

Query with `ScanIndexForward=True` → oldest first, which is what the
sweeper wants.

### 4.3 What removes items from the GSI

The Lambda that transitions the ticket **out of**
`SENDING`/`FAILED_TRANSIENT` clears the GSI keys. Cases:

| Lambda | Trigger | Terminal state | Clears GSI? |
|---|---|---|---|
| `refund-pdf` | SES returns 2xx on first attempt | `SENT` | yes |
| `email-webhook` | SES `Delivery` event via SNS | `DELIVERED` | yes |
| `email-webhook` | SES `Bounce` / `Complaint` event via SNS | `BOUNCED` | yes |
| `email-sweeper` | Retry attempt 3 fails | `FAILED` | yes |
| `email-sweeper` | 24h stuck-in-SENT watchdog | `FAILED` | already unset — `SENT` never had the keys |

**"Clear" = `REMOVE gsi_email_pending_pk, gsi_email_pending_sk`** in the
UpdateExpression, not `SET ... = null`. DDB sparse GSI semantics are
based on attribute **presence**, not value — setting to null keeps the
row in the index.

Node side helper (illustrative):

```typescript
UpdateExpression: "SET email_status = :s REMOVE gsi_email_pending_pk, gsi_email_pending_sk"
```

### 4.4 What `list_email_pending` returns

Everything in the GSI, oldest-first, capped at `limit`. **No re-filter
in the query.** Because the sparse-write contract in 4.3 guarantees the
index only contains rows genuinely awaiting retry, a naive `Query` on
`gsi_email_pending_pk = "EMAIL_PENDING"` with `ScanIndexForward=True`
and `Limit=limit` is exactly right.

If a bug on the write side ever left stale rows in the index,
re-filtering in the query would hide the bug instead of surfacing it.
We want it to surface.

### 4.5 `limit` parameter

Caller passes it in. Sweeper's sensible default is 10-25 per cron tick
(cron every 5 min per `CLAUDE.md`). That is a Node-side tuning knob,
not something you need to hardcode.

Add `limit: int` parameter to `list_email_pending`; the query passes it
straight through to DDB's `Limit`.

### 4.6 Second query pattern — 24h stuck-in-SENT watchdog (heads-up)

Not part of the sparse GSI, but the same `email-sweeper` cron pass runs
a **second** query:

> Tickets where `ticket_state = "EMAIL_SENDING"` AND
> `email_status = "SENT"` AND `email_last_attempt < (now - 24h)`.

These are tickets where SES accepted the send but the delivery event
never came back through SNS (webhook lost, SES event pipeline hiccup,
whatever). After 24h we give up and flip them to `email_status="FAILED"`,
`email_failed_reason="webhook_timeout"`.

**Shape:** this is a `Scan` with `FilterExpression`, NOT a GSI query.
Reason: `email_status="SENT"` rows deliberately have no GSI keys (see
4.3), so there is nothing to Query against. At admin-scale this is
fine — one Scan per 5-min cron tick with a filter that matches maybe a
handful of rows.

Backend contract name: `scanEmailWatchdog(cutoffIso: string)`. When
your side needs to implement this (Python side would only need it if
you decide to run the sweeper in Python; currently it is a Node
Lambda), the shape is `Scan` with FilterExpression on the three
attributes above and a `ProjectionExpression` on the fields the caller
needs.

Flagging so you can plan for it. Not asking you to implement now.

---

## §5 Missing methods — agreed, implement lazily

Fine. Method-per-caller as each Node Lambda gets wired up. No
speculative surface.

Two notes only:

- **`getByEmailForAuth` still open.** Missing on your side. Auth-only
  view returning `email + hashed_password + user_state`, called
  exclusively by `auth-handler`. Add whenever `auth-handler`'s Python
  equivalent needs it — since `auth-handler` is Node, this may end up
  being a TS-side-only method that never exists in your connector.
  Flagging for symmetry with the admin-view method you already added.

- **`ttl` vs `archive_ttl` (proactive heads-up).** DynamoDB honours
  exactly one attribute called `ttl` for automatic deletion. Some rows
  in our schema also carry `archive_ttl` (10y retention for
  buchungsrelevante records post-anonymisation, per HGB §257 / AO §147).
  `archive_ttl` is **application-scanned** — it is NOT read by DDB's
  own TTL sweeper. Whichever side implements the anonymisation cascade
  will need to know: setting `archive_ttl` alone does not delete
  anything; you also need a scheduled scan that acts on it. Not a
  connector change today, just a landmine to know about before it
  ships.

---

## §6 Input validation — agreed, locked

DB layer trusts callers. Validation at the HTTP boundary in backend's
zod layer. No Pydantic on your side.

Locked. If a bug on the backend side ever writes a malformed row, that
is on us, not on the connector.

---

## §7 pain.008 — full context

Fair, this needs explaining. pain.008 is SEPA-specific and locked in
`CLAUDE.md` without asking whether you had the domain background.

### 7.1 What pain.008 is

**pain.008 = ISO 20022 SEPA direct-debit initiation XML.** The format
banks use to accept "please debit €X from these accounts on this date"
instructions in bulk. One XML message = one batch = N debit entries.

In RailBack: we charge users a €0.75 service fee per refund. We do not
touch DB's money — DB pays the user directly via the EU-form. Our fee
is separate: user clicks a mandate button during refund submit, that
gives us the legal authority (SEPA Lastschriftmandat), and after
admin-approves the ticket we execute the debit by handing pain.008 XML
to our bank.

Full field map is in `SEPA_PAIN008.md` (in `projektmanagement/`). Locked
flow is in `CLAUDE.md` under "Payment" and "SEPA Mandate".

### 7.2 Which Lambda

**`pain008-generator`.** Runs post-approval (manual or EventBridge
trigger). Rough shape:

1. Query mandates with `mandate_state = "ISSUED"` AND
   `pain008_built_at IS NOT SET` — that is `listPendingBatches()` on our
   backend interface.
2. Group them into a batch (v1: one mandate per batch, batching is
   trivial; the schema is batch-grouped anyway for future scaling).
3. Build one pain.008 XML string per batch.
4. Upload XML to S3 at `pain008/<batchId>.xml`.
5. For each mandate in the batch: stamp
   `pain008_built_at=<iso>`, `pain008_batch_id=<ulid>`,
   `pain008_s3_key=<s3-key>` on the mandate row.
6. Admin later downloads the XML from S3 (via presigned URL from the
   admin-handler) and manually uploads it to the bank's web-banking
   portal, then hits
   `POST /admin/sepa/batches/{batchId}/mark-submitted` which flips every
   mandate in the batch to `mandate_state = "SUBMITTED"`.

### 7.3 What `stampPain008Built` does to the mandate row

Just step 5 above — an UpdateItem that sets three attributes:

```
SET pain008_built_at = :iso,
    pain008_batch_id = :batch,
    pain008_s3_key   = :key
```

The reason it needs a conditional-write is what happens if step 5 runs
**twice** for the same mandate. Lambda has at-least-once execution
semantics; EventBridge retries; a partial failure can put you into a
state where the Lambda runs again and re-does work.

If a naive `SET` overwrites the mandate row on the second run:

- The **first** batch XML has already been submitted to the bank
  (physically, on paper — or on the bank portal). Our records
  temporarily said `pain008_batch_id = A`.
- The **second** Lambda run generates a new batch XML `B`, uploads it
  to a different S3 key, and overwrites the mandate to say
  `pain008_batch_id = B`.
- Now our records point to batch B but the bank is actually processing
  batch A. When the bank sends back a pain.002 / camt.054 with
  reference "A", we lookup by mandate → find "B" → no match → we
  cannot reconcile the settlement.

**Conditional write fix:** the UpdateItem carries
`ConditionExpression: attribute_not_exists(pain008_built_at)`. The
first run succeeds (attribute is absent), stamps the mandate, done.
The second run's condition fails, DDB throws
`ConditionalCheckFailedException`, the caller catches it and logs
"mandate X already stamped by a prior run, skipping — batch already at
bank." No overwrite, no lost audit trail.

Backend interface signature:

```typescript
stampPain008Built(
  email: string,
  id: string,
  info: { batchId: string; s3Key: string; builtAt: string }
): Promise<void>
// throws ERR_CONFLICT if pain008_built_at already set
```

Python equivalent — as method on your `SepaMandateConnector`:

```python
def stamp_pain008_built(
    self, email: str, ticket_id: str,
    batch_id: str, s3_key: str, built_at: str
) -> Result:
    # UpdateItem with ConditionExpression="attribute_not_exists(pain008_built_at)"
    # Translate ConditionalCheckFailedException → Err(ConflictError(...))
```

### 7.4 What `ERR_CONFLICT` means to the caller

**Silently skip. Not retry, not alert.** The conflict is not a bug — it
is normal Lambda at-least-once semantics doing their job. The
convention:

- `pain008-generator` catches `ERR_CONFLICT` per mandate, logs at INFO
  level: `"mandate=<id> already stamped by prior run, skipping"`.
- Continues to the next mandate in the batch.
- Batch-level success/failure is measured by "did we build and upload
  the XML" — not by "did every mandate accept the stamp."

Idempotency by conditional-write is a well-established pattern; the
caller treats `ERR_CONFLICT` as "someone else did my work, good, move
on."

### 7.5 Bare minimum for the connector

A conditional-write helper on `BaseConnector`. Rough shape:

```python
@safe
def _update_conditional(
    self, pk: str, sk: str, updates: dict, condition: str
) -> Result:
    if not updates:
        return Ok(None)
    set_parts, names, values = [], {}, {}
    for i, (k, v) in enumerate(updates.items()):
        ph_n, ph_v = f"#f{i}", f":v{i}"
        set_parts.append(f"{ph_n} = {ph_v}")
        names[ph_n] = k
        values[ph_v] = v
    try:
        self._t.update_item(
            Key={"pk": pk, "sk": sk},
            UpdateExpression="SET " + ", ".join(set_parts),
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
        return Ok(None)
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return Err(ConflictError(f"condition failed on ({pk}, {sk})"))
        raise
```

Then `SepaMandateConnector.stamp_pain008_built` uses it. `ConflictError`
would be a new exception type in `db/base.py` alongside `Ok`/`Err`.

Sketch only — take the shape, adapt to your conventions.

---

## §8 Region

Skip. Reviewer confirmed they had no strong claim on which region SES
lives in either; the `eu-central-1` in the review was reviewer's guess,
not a locked fact. `eu-north-1` for DDB is fine. If it turns out later
that SES-elsewhere has meaningful latency cost for some cron path, we
revisit then.

Not a blocker on anything.

---

## §9 Small stuff

### §9.1 SK filter — good, thanks.

### §9.2 – §9.4

Fine to defer. Two things to keep in mind when you get there:

- **`_query` autopaging:** the risk is only on partitions that can grow
  unbounded — `list_for_user` (a user can accumulate 100+ tickets over
  time), admin list-all, mandate list. On the smaller partitions
  (segments per train per date is bounded by the stop count) it does
  not matter.
- **`delete_user` cascade:** the current shape handles the common case.
  Edge cases (raw/rendered rows orphaned from a hard-deleted ticket)
  can wait for the anonymisation-sweeper design pass.

---

## Summary of what changes on which side

**On your side:**
1. Add `#<trainNr>` suffix to `TrainSegmentDelayConnector`'s `gsi1_sk`
   writes (§3).
2. Add `limit: int` parameter to `list_email_pending` (§4.5).
3. When the pain.008 flow gets wired up: add conditional-write support
   on `BaseConnector`, then a `stamp_pain008_built` method on
   `SepaMandateConnector` (§7.5).
4. Continue implementing missing methods lazily, per caller (§5).

**On backend side:**
1. Marshal TS-uppercase ↔ DDB-lowercase in `lib/src/storage/ddb/*` (§2).
2. Own the sparse-GSI write/clear discipline in the Lambdas that
   transition `email_status` (§4.3).
3. Implement `scanEmailWatchdog` as `Scan+FilterExpression` when
   `email-sweeper` Pass B gets built (§4.6).

**Locked decisions written to `DECISIONS.md` today:**
- Option C integration model.
- Lowercase wire-format attribute names.

---

*Written by application-server-side on 2026-07-05, response to
`SCHEMA_REVIEW_RESPONSE_2026-07-05.md`.*
