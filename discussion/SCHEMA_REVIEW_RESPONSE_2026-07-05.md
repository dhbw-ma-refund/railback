# RailBack DB Layer — Response to Cross-Team Review (2026-07-05)

Responding to the review written on behalf of the backend person.

---

## §1 Integration model

Option C. The Python connector serves the Python Lambdas (`ticket-extractor`,
`ingest-delays`). Node Lambdas get their own TypeScript DynamoDB implementation,
using this connector as the reference for key shapes, attribute names, and
access patterns.

The connector's design does not change based on this. Both sides write to the
same table under the same conventions. A shared schema document that both sides
update in lockstep is a prerequisite before either side adds a new entity or
index.

---

## §2 Attribute-name case — no change, and a broader point about access

The DynamoDB table was provisioned by us with lowercase attribute names (`pk`,
`sk`, `gsi1_pk`, `gsi1_sk`, etc.). That table exists and has been tested against
real AWS. The lowercase convention is established and will not change.

The deeper issue is that the backend should not be touching DynamoDB directly
at all. The connector exists precisely so that nothing outside it has to know or
care about physical attribute names, key shapes, index names, or any other
DynamoDB internals. If the backend's TypeScript types declare uppercase keys
(`PK`, `SK`, ...), those are an internal TS concern and have no bearing on the
physical table.

The default expectation is: **every database operation goes through the
connector.** If the backend believes it has a case for bypassing the connector
and talking to DynamoDB directly, that case needs to be made explicitly and
agreed on. "Our TypeScript types use uppercase" is not that case — that is a
typing convention the backend can resolve internally.

For the Node Lambdas that cannot import Python (see §1), the backend will write
a TypeScript DynamoDB implementation. That implementation must use the physical
lowercase attribute names. Any divergence between the TS impl and the Python
connector is schema drift risk, which is exactly what we are trying to avoid.

No change on the DB side.

---

## §3 GSI3 vs GSI1 for route-lookup — not a backend concern

Which GSI backs the route-lookup query is an internal DB implementation detail.
The backend calls a method and gets results back. Whether that method uses GSI1,
GSI3, or something else is not something the backend should need an opinion on.

We are keeping the current approach: GSI1 with `STATION#{eva}#{date}` as the PK.
Fewer indexes, lower write-amplification cost, same query results. If we ever
need to change this for performance reasons, we will change it — without the
backend noticing.

One thing that does need a decision from the team: the sort-key tiebreaker for
same-station same-minute departures. If two trains depart the same station at
the same minute, the current `BETWEEN` query returns both rows. Is that correct
behaviour, or does the backend expect at most one result? If the backend needs
a tiebreaker so results are deterministically ordered, tell us the format and
we will add it to the SK.

**Action needed: confirm whether same-minute collisions returning multiple results
is expected or a problem.**

---

## §4 Email-pending GSI — we need a full spec before we can implement anything

The review flags a gap but does not give us enough to act on. We do not know
how this GSI is supposed to work. We need the backend to explain the full
picture from scratch:

1. **What goes into the GSI?** When a ticket enters the retry queue, who writes
   `gsi_email_pending_pk = "EMAIL_PENDING"` and `gsi_email_pending_sk = <what?>`
   onto the ticket row? Is that the connector's job (called from the DB layer),
   the email handler Lambda, or something else?

2. **What does the SK contain?** The review mentions `email_last_attempt` as the
   sort key so the sweeper can pick the oldest-first. Is the SK a timestamp?
   An ISO string? A Unix epoch? Exact format, please.

3. **What removes items from the GSI?** The review says the GSI is "sparse" —
   meaning the keys are cleared when a ticket is no longer pending. Which Lambda
   does that, on which state transitions, and what does "clear" mean concretely
   (set to null, remove the attribute, or something else)?

4. **What should `list_email_pending` return?** The review says callers must not
   re-filter, implying the GSI only contains items that genuinely need a retry.
   If that is true, the connector just queries and returns everything in the GSI.
   If that is not true and there can be stale items, the connector needs to know
   the filter condition.

5. **What is the `limit` parameter for?** The review mentions the sweeper picks
   off a batch per cron tick. What is the batch size? Does the caller pass it in,
   or is it a fixed value?

Until we have answers to all five of these, we cannot implement this correctly.
The current connector returns everything under `EMAIL_PENDING` in insertion
order. If that matches the expected behaviour, say so and we will just add the
`limit` parameter. If not, explain the full contract.

---

## §5 Missing methods

### §5.1 Admin view of user — done

`UserConnector.get_for_admin(email)` now exists. It returns the full profile
row minus `iban_enc` and `bic_enc`. Admin Lambdas should call this instead of
`get`. Bank ciphertext does not leave the DB layer on admin reads.

### §5.2 – §5.5 Everything else

We will implement these as each Lambda is being wired up. There is no point
writing methods before there is a caller to validate the signature against.

---

## §6 Input validation

The DB layer trusts callers. Validation happens at the HTTP boundary in the
backend's zod layer. Once a DTO has passed that, the connector writes what it
receives. We are not adding Pydantic models — that would create a second source
of truth for every schema.

This is now documented in the connector's README.

---

## §7 Conditional write on mandate — need more context

We are not familiar with what `stampPain008Built` is or what pain.008 generation
means in the context of this project. The review mentions a conditional-write
requirement (`attribute_not_exists(pain008_built_at)`) and a risk around double
Lambda execution.

Before we can respond or build anything here, the backend person needs to explain:

1. What is pain.008 generation, and which Lambda runs it?
2. What is `stampPain008Built` supposed to do to the mandate row?
3. What does `ERR_CONFLICT` mean to the calling Lambda — does it retry, skip, or
   alert?

Once we understand the flow, we can assess whether the connector needs
conditional write support and implement accordingly.

---

## §8 Region — eu-north-1, not changing

The table is in `eu-north-1`. It exists, it is tested, and we are not
provisioning a new table. The table stays where it is.

---

## §9 Small stuff

### §9.1 SK filter in `list_for_user` — fixed

The naive string filter (`"#BELEG#" not in sk and not sk.endswith("#MANDATE")`)
has been replaced with a helper that checks the SK starts with `TICKET#` and
contains no second `#`. Adding new compound SK variants will no longer break this
query.

### §9.2 – §9.4

Noted. We will address autopagination and `delete_user` cascade hardening when
the relevant flows are being wired up. `created_at` is the caller's
responsibility; we will document that.

---

*Written by DB-side on 2026-07-05.*
