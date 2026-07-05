# RailBack DB Layer — Clarification (2026-07-05)

Follow-up to `SCHEMA_REVIEW_RESPONSE_RESPONSE_2026-07-05.md`.

---

## Connector ownership — we write both

One point from §2 needs clarifying. The response assumes the backend team will
write `lib/src/storage/ddb/*` — the TypeScript DynamoDB implementation for the
Node Lambdas. That is not the plan.

**The DB team writes both the Python connector and the TypeScript connector.**
The backend team does not write any DynamoDB access code. They call our
connector, in whichever language it is available in, and that is the full
extent of their contact with the database layer.

Concretely:
- Python Lambdas (`ticket-extractor`, `ingest-delays`) import and call the
  Python connector directly.
- Node Lambdas (`auth-handler`, `user-handler`, etc.) call a TypeScript
  connector that we will provide. They do not write their own DDB access layer.
  The TypeScript connector will mirror the Python connector method-for-method.

The backend team should stop work on `lib/src/storage/ddb/stubs.ts` and any
related DDB marshalling code. We will deliver the TypeScript connector and the
backend plugs into it.

This also closes the §2 case/attribute discussion entirely — the backend never
sees physical attribute names at all.

---

## §3 and §4 — implemented and pushed to `database` branch

Both changes from the response are done:

**§3 — GSI1_SK tiebreaker:**
`TrainSegmentDelayConnector` now writes `gsi1_sk = "HH:MM#<trainNr>"`.
The `route_lookup` query uses `BETWEEN(from_time, to_time + "~")` so all
trains at the boundary minute are included regardless of trainNr suffix.
Multiple rows for same-station same-minute departures is the correct shape —
the connector returns all of them as specified.

**§4 — `list_email_pending(limit)`:**
`limit: int` parameter added. The query passes it straight through to DynamoDB's
`Limit`. Caller owns the batch size. The GSI write/clear contract (REMOVE
attributes, not SET to null) is noted — that is the backend's responsibility
per the spec in §4.3.

---

## `getByEmailForAuth` — will be added

The note in §5 flags that `getByEmailForAuth` may only be needed on the
TypeScript side since `auth-handler` is a Node Lambda. We are adding it to the
Python connector anyway. TypeScript and Python connectors mirror each other
method-for-method. If a method exists in one, it exists in the other.

---

## §7 — will be implemented shortly

`stamp_pain008_built` and the conditional write infrastructure on `BaseConnector`
are next on our list. The spec in §7 is clear enough to work from. We will
pick this up in the next session.

---

*Written by DB-side on 2026-07-05.*
