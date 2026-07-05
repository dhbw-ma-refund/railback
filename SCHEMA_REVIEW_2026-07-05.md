# RailBack DB Layer — Cross-Team Review (2026-07-05)

This document is for the **DB person's Claude / DB person** to work through.
It compares the connector layer on `database` branch (this repo) against
what the application-server side on `backend` branch expects (types + repo
interfaces in `lib/src/storage/` and `lib/src/types/`).

**Baseline commits reviewed:**
- `database` branch: `6a41bf3` "rename unittests/ to tests/"
- `backend` branch: `44e59ac` "phase 4 complete (without phase 3)"

**Reviewer's context / caveats — read this before acting on anything below:**

- The reviewer sat on the app-server side. This is a one-sided read; the DB
  person hasn't been in the room for it. Every "who moves" call below is a
  suggestion, not a decision.
- **We don't know where input validation happens.** The backend has `zod`
  schemas for HTTP boundaries, but there's no agreed line for what the DB
  layer trusts vs. re-validates. The connector currently trusts every
  `dict`/`item` blindly. See §6.
- **We don't know how the two codebases will be integrated.** The backend
  is TypeScript-on-Node-Lambda. The DB layer is Python. There is no
  documented plan for whether the Python connector is:
  - (a) a reference implementation to be ported to TypeScript,
  - (b) something the Node Lambdas will invoke cross-language (they
    can't — there's no bridge),
  - (c) used only by Python Lambdas (`ticket-extractor`, `ingest-delays`),
  - (d) a design study that won't run in production.
  This has to be resolved before any of the concrete gaps below matter.
  See §1.

Everything below assumes we WILL find a way to make the two sides talk to
the same DynamoDB table with the same key/attribute conventions. If the
answer to §1 is "we don't", most of §3–§5 becomes moot.

---

## 1. Integration model — the biggest unresolved question

**What exists:**
- Backend (Node/TypeScript) declares a `Db` interface (`lib/src/storage/types.ts`)
  with repo contracts like `UserRepo`, `TicketRepo`, `MandateRepo`, etc.
  Handlers depend on `Db`; storage backends (memory, file, ddb) satisfy it.
  There's a `ddb/stubs.ts` file — real DDB impl is not written yet.
- DB layer (Python) declares a `RailBackConnector` class aggregating one
  connector-per-entity. It talks to DynamoDB directly via `boto3`.

**What is NOT decided:**
- Which Lambdas call which layer.
  - `ticket-extractor` and `ingest-delays` are Python — they could import
    the Python connector directly (same runtime).
  - `auth-handler`, `user-handler`, `admin-handler`, `refund-pdf`,
    `email-sweeper`, `email-webhook`, `pain008-generator`,
    `anonymisation-sweeper`, `sepa-reports` are all Node — they cannot
    import Python code. They need either their own TypeScript DDB impl
    or the Python connector fronted by an internal HTTP/Lambda-invoke
    surface (nobody has proposed this).

**Options to discuss (pick one before doing anything else):**

| Option | Description | Cost |
|---|---|---|
| A | Python connector is a **reference impl**; backend team ports the shape to TS in `lib/src/storage/ddb/`. DB person owns schema decisions, backend owns the wire code. | Duplicated code, but both runtimes stay pure. |
| B | Python connector is the **canonical impl**; all Node Lambdas rewrite as Python. | Big rewrite on backend side. Probably not realistic given how much Node code is already written. |
| C | Python connector serves only Python Lambdas (`ticket-extractor`, `ingest-delays`). Node Lambdas get their own TS impl. Two codebases, same schema. | Schema drift risk unless both sides share a spec file (JSON Schema / a `TABLE_SCHEMA.md` both sides read). |
| D | Python connector is design-only, doesn't run in production. | The DB person's work becomes documentation. |

**Recommendation:** either A or C. The DB person's `db/base.py` +
`db/connector.py` is short and clear enough to serve as a reference the
backend can port; the split between "who runs what" is cleanest under C
but only if we commit to a shared schema doc that both sides update in
lockstep.

**Action:** decide this before touching anything else. Everything below
assumes the schemas need to line up; if the answer is D, delete this
review.

---

## 2. Attribute-name case mismatch — highest-priority

**What the DB layer does:** writes lowercase attribute names
(`pk`, `sk`, `gsi1_pk`, `gsi1_sk`, `gsi2_pk`, `gsi2_sk`,
`gsi_email_pending_pk`).

**What the backend expects:** uppercase (`PK`, `SK`, `GSI1_PK`, `GSI1_SK`,
`GSI2_PK`, `GSI2_SK`, `GSI_EMAIL_PENDING_PK`, `GSI_EMAIL_PENDING_SK`).
See `lib/src/types/items.ts` on the backend side — every `Item` interface
declares uppercase fields.

DynamoDB attribute names are **case-sensitive**. `pk` and `PK` are
different attributes. If both sides talk to the same table they will not
find each other's rows at all.

Also affected — index names. His `list_email_pending` queries
`IndexName="gsi_email_pending"`. The backend's `keys.ts` file talks about
`GSI_EMAIL_PENDING`.

**Unresolved:** we never agreed on a case convention. Both are valid;
just pick one. Uppercase matches most published DDB single-table
tutorials (Alex DeBrie, DynamoDB Book). Lowercase is Pythonic.

**Suggested action:** align on **uppercase**, because
- backend types + `keys.ts` already declare it that way and are used by
  ~10 Lambdas,
- flipping the connector is a small change (`sed` across `connector.py`
  + create the table with uppercase attribute definitions when defining
  GSIs),
- keeps DDB-tutorial conventions.

If lowercase wins instead, backend side has to rewrite `keys.ts` and
every `Item` interface in `items.ts`.

---
## 3. GSI3 (station route-lookup) — schema decision needed

**What the DB layer does:** `TrainSegmentDelayConnector.route_lookup`
uses **GSI1** with key `STATION#{eva}#{date}`.

**What the backend expects:** a **separate GSI3** with
`GSI3_PK = STATION#{eva}#{date}` and `GSI3_SK = {plannedDeparture}#{trainNr}`.
See `lib/src/storage/ddb/keys.ts:99-106` and
`lib/src/types/items.ts:234-235`.

**Why this matters:** both sides work functionally — DynamoDB doesn't
care that GSI1 carries mixed key shapes (`USER`, `ADMIN`,
`TRAIN#nr#date`, `STATION#eva#date`) as long as your
`KeyConditionExpression` filters correctly. But:

- Consolidating into one GSI is **cheaper** (one fewer index to
  provision, one fewer write-amplification cost per Put).
- Splitting into two GSIs makes each index's role **clearer** and
  keeps hot-partition risk isolated (e.g. Berlin Hbf as a station has
  far more traffic than any single train).

**Unresolved:** which do we want? Neither side made this call explicitly.

**Suggested action:**
- If we agree on **GSI1-only**: backend deletes GSI3 from `keys.ts` +
  `items.ts` and adds a note in `DB_SCHEMA.md` explaining the shared-GSI1
  pattern.
- If we agree on **GSI3-separate**: DB layer adds a second GSI to its
  `TrainSegmentDelay` writes and route-lookup query.

Also: the current sort-key shape needs to be settled either way. Backend
uses `{plannedDeparture}#{trainNr}` (train number as tiebreaker so
`BETWEEN` on time still works and duplicates are resolvable). DB layer
uses `BETWEEN(from_time, to_time)` on `gsi1_sk` — implicit that the SK
IS the departure time. Fine, but tiebreaker matters if two trains
depart the same station at the same HH:MM.

---

## 4. Sparse GSI on `GSI_EMAIL_PENDING` — contract of use

**What the DB layer does:** `list_email_pending` does a plain Query on
the index and returns everything under `PK = "EMAIL_PENDING"`.

**What the backend expects** (`lib/src/storage/types.ts:96-100`):

> Query `GSI_EMAIL_PENDING` ascending by SK (oldest `email_last_attempt`
> first). Returns at most `limit` tickets currently in the retry queue —
> i.e. `email_status IN ("SENDING","FAILED_TRANSIENT")` with
> `email_attempts < 3` (**the GSI is sparse on the write side; callers
> MUST NOT re-filter**).

Meaning: the writer of the item (whichever Lambda transitions
`email_status`) is expected to **clear** `GSI_EMAIL_PENDING_PK` /
`GSI_EMAIL_PENDING_SK` on state transitions like SES-2xx →
`email_status="SENT"`, delivery-event → `DELIVERED`, attempt-3 fail →
`FAILED`. If those keys aren't cleared, the retry sweeper will re-send
already-delivered emails.

This is **not a bug in the connector** — it's a contract-of-use
question. But it's not written down anywhere on the DB side, so the DB
person's connector is silently trusting a rule his README doesn't state.

**Unresolved:** who owns enforcing the sparse-write? If the connector's
`TicketConnector.update` is where email-state transitions happen, the
connector could enforce it (auto-clear GSI keys when
`email_status` moves out of `SENDING`/`FAILED_TRANSIENT`). Otherwise
the calling handler owns it and the connector needs a comment saying so.

**Also missing:** a `limit` parameter on `list_email_pending`. Backend
contract says `queryEmailPending(limit: number)`. Sweeper picks off a
batch per cron tick, doesn't want to page through everything.

**Suggested action:** either
- add explicit `set_email_status(email, ticket_id, new_status, ...)`
  helpers on `TicketConnector` that manage the GSI-key clearing, OR
- add a `docstring` block on `list_email_pending` documenting the
  sparse-write contract and let handlers own it.

Add `limit` parameter to `list_email_pending`.

---

## 5. Missing methods that the backend interface requires

This is a **feature list**, not bugs. The backend's `Db` interface
(`lib/src/storage/types.ts`) enumerates every operation the handlers
need. The connector currently has generic `get/put/update` per entity
plus a handful of specific queries. Everything below is declared on the
interface but has no counterpart in `connector.py`:

### 5.1 UserRepo — projection views (privacy critical)

- `getByEmailForAuth(email)` — returns hashed_password + user_state.
  Auth-only view.
- `getByEmailAdminView(email)` — strips `iban_enc` / `bic_enc` / `ttl`
  before returning.

**Why this matters:** CLAUDE.md locks the rule "IBAN/BIC must NOT be
visible to admin." The API layer already projects them away, but the
locked design wants **defense-in-depth at the repo layer** so admin
Lambda memory never holds bank ciphertext. Currently
`UserConnector.get` returns the whole row.

**Unresolved:** is projection the DB layer's job or the handler's?
Both are defensible. If the DB layer owns it, the connector needs to
know who's calling (auth vs admin vs user-self). If the handler owns
it, backend types remove `getByEmailAdminView` from the interface.

### 5.2 TicketRepo

- `queryEmailPending(limit)` — see §4.
- `scanEmailWatchdog(cutoffIso)` — `Scan` with FilterExpression on
  `ticket_state="EMAIL_SENDING" AND email_status="SENT" AND
  email_last_attempt < cutoffIso`. Powers the 24h stuck-in-SENT watchdog.
- `anonymiseUserTickets(email, anonPk, nowIso)` — rewrite PK from
  `USER#<email>` to `USER#sha256:<hash>`, null out PII fields, refresh
  `updated_at`. Returns list of touched `ticketId`s.
- `enumerateAllTicketIdsForUser(email)` — every ticketId with any trace
  under `USER#<email>` (`TICKET#/RAW#/RENDERED#/BELEG#/MANDATE#` rows).
  For anonymisation-sweeper cascade.
- Admin queries: current `get_by_train` uses GSI1. Backend `AdminTicketQuery`
  is broader — email filter, state filter, cursor pagination.

### 5.3 UserRepo — anonymisation-sweeper

- `scanDeletionScheduledExpired(nowEpochSec)` — linear scan for profiles
  with `user_state="DELETION_SCHEDULED" AND ttl < nowEpochSec`.
- `scanOrphanUserPks()` — linear scan for `USER#*` partitions with
  child rows but no profile row (DDB's own TTL sweeper may evict the
  profile before ours does).
- `deleteByEmail(email)` — hard delete profile row (idempotent).

### 5.4 MandateRepo — big gap

- `getByMandateId(mandateId)` — reverse lookup by ULID stamped on
  `EndToEndId` of pain.008 payment info. Used when parsing
  bank-returned pain.002 / camt.054 XML. Linear scan in v1 (admin-scale
  mandate volume).
- `listPendingBatches()` — mandates awaiting pain.008 build.
- `listByBatchId(batchId)` — flip whole batch from ISSUED → SUBMITTED.
- `listExpiringISSUED(now)` — mandates aging out of the 36-month window.
- State-transition helpers: `markSubmitted`, `markDebited`, `markReversed`,
  `markDisputed`, `markExpired`, `markCancelled`. Currently his generic
  `update()` covers this by-field, but there's no state-machine enforcement.
- **`stampPain008Built` MUST be a conditional write.**
  See §7 — separate item because it's a data-integrity risk, not just
  a missing method.
- `anonymiseUserMandates(email, anonPk)` — rewrite mandate PKs on
  cascade, null bank ciphertext, keep non-PII.

### 5.5 RouteTemplateRepo

- `deleteAllForUser(email)` — hard delete every TEMPLATE#-row on
  anonymisation cascade.

### 5.6 BlobRepo (S3-side — not the DB person's job?)

Backend types declare S3 ops here (`presignRawUploadPost`,
`presignReceiptPost`, `getBytes`, `putBytes`, `deleteBytes`,
`deleteRawUpload`, `deleteRenderedPdf`, `deleteAllReceipts`). The
Python connector has `raw_upload` / `rendered_pdf` / `receipt`
connectors that manage **only the DDB metadata rows**. That's actually
correct separation — S3 is a separate service.

**Unresolved:** we never wrote down "S3 side is out of scope for the
DB layer." Please confirm.

---

## 6. Input validation — where does it live?

**Currently:** the connector trusts every `dict` handed to `put()` /
`update()` verbatim. It writes whatever attributes are in the dict. No
type checks, no required-field checks, no enum validation.

**On the backend:** `zod` schemas validate at the HTTP boundary
(`lib/src/schemas/*`). Once past validation, a `NewUser` /
`NewTicket` / `NewMandate` DTO is trusted.

**Unresolved:** where's the trust boundary between backend and DB
layer? Two clean answers:

1. **DB layer trusts callers.** Validation is exclusively the caller's
   job. The connector is a thin wrapper. Fastest, but any bug on the
   caller side corrupts the table.
2. **DB layer re-validates on write.** Pydantic v2 models mirror the
   backend's zod schemas. Slower but catches drift.

We haven't picked. If we go with A, the connector needs a
`README.md` line stating "callers are responsible for schema validation;
this layer trusts input." If we go with B, DB person needs to add
pydantic models for every entity.

**Related risk if we don't pick:** the connector's `_update_fields`
lets any dict key become a set expression. That means a buggy handler
could accidentally SET a mistyped field like `emial_status` and the
DDB row would silently gain a garbage attribute. No schema evolution
control at all.

---

## 7. Conditional write missing on `stampPain008Built` — data integrity

**Backend contract** (`lib/src/storage/types.ts:222-236`):

> Conditional-write contract: if `pain008_built_at` is already set,
> MUST throw `ERR_CONFLICT` instead of overwriting.
> Real DDB impl: `UpdateItem` with
> `ConditionExpression: attribute_not_exists(pain008_built_at)`
> and translate `ConditionalCheckFailedException` → `ERR_CONFLICT`.

**Current DB layer:** `SepaMandateConnector.update` is a plain `SET`
via `_update_fields`. No condition support.

**Impact:** double-run of `pain008-generator` (which is possible under
Lambda's at-least-once semantics + EventBridge cron races) overwrites
the batch ID. The **first** batch XML has been submitted to the bank;
the **second** row-write erases the reference. Reconciliation with
pain.002 / camt.054 breaks.

**Suggested action:** add a `_update_conditional` on `BaseConnector`
that takes an extra `ConditionExpression` and translates
`ConditionalCheckFailedException` → an `Err(ConflictError(...))` so the
caller can distinguish. Then `SepaMandateConnector` gets a specific
`stamp_pain008_built(...)` method.

---

## 8. Region mismatch — coordinate with backend

DB layer: `REGION = "eu-north-1"` (Stockholm).
Backend: SES pinned to `eu-central-1` (Frankfurt); CLAUDE.md doesn't
lock DDB region explicitly but SES/DDB co-location is the natural
default.

**Unresolved:** did the DB person pick `eu-north-1` on purpose? DSGVO-
fine either way. The cost is inter-region latency (Stockholm ↔ Frankfurt
adds ~20ms per DDB call from Lambdas running in eu-central-1) and one
extra cross-region data-transfer bill.

**Suggested action:** either move DDB to `eu-central-1` (change one
constant, recreate the table) or explicitly lock the split in
`DECISIONS.md`.

---

## 9. Small stuff worth fixing while we're here

### 9.1 Naive suffix filter in `list_for_user`

`connector.py:83`:

```python
return Ok([i for i in result.unwrap() if "#BELEG#" not in i["sk"] and not i["sk"].endswith("#MANDATE")])
```

Works today because your only compound SKs are `TICKET#{id}#BELEG#{id}`
and `TICKET#{id}#MANDATE`. Breaks the moment you add a third variant
(e.g. `TICKET#{id}#REFUND_ATTEMPT#{n}` or similar).

Cleaner filter (matches the backend's `parseTicketSk` shape): "SK
starts with `TICKET#` AND has no second `#`":

```python
def _is_plain_ticket_sk(sk: str) -> bool:
    return sk.startswith("TICKET#") and "#" not in sk[len("TICKET#"):]
```

### 9.2 `_query` auto-pages everything

`BaseConnector._query` loops on `LastEvaluatedKey` until empty. Fine for
small partitions, dangerous on `list_for_user` when a user has
100+ tickets — one blocking call could span many DDB pages. Add a
`limit` param and return `(items, cursor)` for the ops that need
pagination (admin list, mandate list, template list).

### 9.3 `delete_user` cascade doesn't cover mandates / belege / raw / rendered

`RailBackConnector.delete_user` queries `USER#<email>` and batch-deletes.
That's fine for `PROFILE` + `TICKET#*` + `RAW#*` + `RENDERED#*` + belege
(they all share the PK). But **`TICKET#<id>#MANDATE`** rows have
sk starting with `TICKET#` and get picked up too — good, no bug.
However, the corresponding `TICKET#<id>` OWNER rows are only picked
up for TICKET#* sk's, not for the RAW#/RENDERED# ones. Currently only
line 282-284 adds the OWNER cascade for plain `TICKET#` SKs. If a
user's tickets have raw uploads and rendered PDFs but the TICKET# row
was already deleted somehow, OWNER rows would leak.

Low-risk edge case, but worth a defensive line.

### 9.4 No `created_at` set anywhere

The connector's `put` is a pass-through. Every DDB row in the backend's
`items.ts` has `created_at` (or `uploaded_at` / `issued_at` / etc.).
Someone has to set these — currently, the caller. Confirm this is the
caller's job and document it.

---

## 10. What's genuinely good

Not just a bug list — worth calling out what's clean:

- `Ok`/`Err`/`@safe` decorator: nice explicit error surface. `ClientError`
  gets logged with the DDB error code and returned as `Err`. Cleaner than
  raw `try/except` in every handler.
- Key conventions match: `USER#<email>`, `TICKET#<id>`, `RAW#<id>`,
  `RENDERED#<id>`, `TICKET#<id>#BELEG#<id>`, `TICKET#<id>#MANDATE`,
  `TEMPLATE#<id>`, `TRAIN#<nr>#<date>`, `SEG#<id>`, `SEPA#REPORT#<date>`,
  `REPORT#<id>` — every one lines up with backend's `keys.ts`. **This is
  the load-bearing part** and it's right.
- `TicketOwnerConnector` exists and `delete_ticket` correctly cascades to
  the OWNER row (`connector.py:298`). Matches locked 2026-06-20 decision.
- `AdminConnector` exists — CLAUDE.md's admin-out-of-band flow works.
- `check_barcode_duplicate` shape matches backend's `findByBarcodeUid`
  contract (GSI2 with `PK="BARCODE"`, SK=`barcode_uid`).
- `route_lookup` shape is correct except for the GSI-name/GSI3 question
  in §3. The `BETWEEN` on time-range is exactly right.
- Test coverage looks comprehensive — one test file per entity, plus
  walkthrough + pagination + connection-error tests. Reviewer hasn't
  read the tests in depth but the file list suggests good discipline.

---

## Action items — proposed order

1. **§1** — DB person + backend person agree on integration model (A/B/C/D). Everything below assumes we've picked A or C.
2. **§6** — decide validation ownership. Trust caller or re-validate.
3. **§2** — pick attribute-name case. Whoever loses does the mechanical rename.
4. **§3** — decide GSI1-shared vs GSI3-separate for route-lookup.
5. **§8** — confirm region (`eu-north-1` vs `eu-central-1`).
6. **§7** — DB person adds conditional-write support on `_update_fields`.
7. **§4** — DB person documents sparse-GSI contract (or moves it into the connector).
8. **§5** — DB person implements missing methods incrementally as backend Lambdas need them. Not blocking until each Lambda is being wired up.
9. **§9** — housekeeping, do whenever.

---

## Open questions for the DB person to answer

1. Was `eu-north-1` intentional or default?
2. Is projection (`getByEmailAdminView`) something you want to own at the
   connector, or should backend handle it?
3. `list_email_pending` — do you want to own the sparse-key
   maintenance in a `set_email_status` helper, or leave it to callers?
4. Do you consider S3-side operations part of your layer, or strictly DDB?
5. What was the plan for input validation?
6. Are the tests running against DynamoDB Local only, or have you also
   validated against a real AWS table? The `tests/test_walkthrough.py`
   integration test would be the natural place to prove the schema works
   end-to-end.

---

*Written by application-server-side Claude on behalf of the backend
person. If any of this reads as prescriptive rather than exploratory,
that's a tone bug — every "should" here is really a "let's discuss."*
