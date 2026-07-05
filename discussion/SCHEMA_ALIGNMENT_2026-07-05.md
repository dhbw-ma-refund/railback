# RailBack DB Layer — Alignment on Connector Ownership (2026-07-05)

Response to `SCHEMA_CLARIFICATION_2026-07-05.md`.

Naming break from the "response_response_response..." chain: at this
depth the joke stops being funny and starts being confusing. This one
is `SCHEMA_ALIGNMENT_2026-07-05.md`. Every subsequent doc in this
back-and-forth uses a descriptive name.

---

## The offer — accepted, with five guardrails

We accept: DB team owns both the Python connector and the TypeScript
connector. Backend team writes no DynamoDB access code. `stubs.ts`
becomes dead code.

This is a genuinely better outcome than the two-parallel-codebases
model we locked yesterday morning. Single author for both wire
surfaces removes drift risk almost entirely. Thanks for offering.

The rest of this doc is the terms we need to agree on to make it work
cleanly. None of these are negotiating points — they are consequences
of how the backend code is already structured, and getting any of them
wrong will cost us more than the drift risk we just eliminated.

---

## Guardrail 1 — TS connector implements our existing `Db` interface

Our handlers are already written against `lib/src/storage/types.ts`:

```typescript
export interface UserRepo {
  getByEmail(email: string): Promise<User | null>;
  getByEmailForAuth(email: string): Promise<UserAuthLookup | null>;
  getByEmailAdminView(email: string): Promise<UserAdminView | null>;
  create(user: NewUser): Promise<User>;
  updateProfile(email: string, patch: ProfilePatch): Promise<User>;
  // ...
}
export interface TicketRepo { ... }
export interface Db { users: UserRepo; tickets: TicketRepo; ... }
```

The full interface is in `lib/src/storage/types.ts` on the `backend`
branch — happy to hand you a copy or you can pull the branch directly.

**Ask:** your TS connector implements this `Db` interface. Method
names, argument shapes, return types as declared. Method names are
TS-idiomatic camelCase (`getByEmailAdminView`, not `get_for_admin`).

If a method needs a different signature than what's on the interface,
the interface changes first via PR review, and the connector follows —
not the other way around. This keeps the boundary stable while allowing
real evolution.

Why this matters: ~10 Lambdas' worth of handler code already imports
from `../types.js` and calls `db.users.getByEmailAdminView(...)` shape.
If the TS connector exposes a Python-mirrored shape
(`user.get_for_admin(...)`), we rewrite every handler. If it implements
the interface, we swap `stubs.ts` for your impl and every handler works
unchanged.

---

## Guardrail 2 — Errors thrown, not wrapped in Result

Your Python connector uses `Ok`/`Err`/`@safe`. That is a clean pattern
in Python. In TypeScript, the idiomatic pattern is throwing promises
with typed error classes:

```typescript
// Your TS connector's public surface:
async getByEmail(email: string): Promise<User | null> {
  // ... internally may use Result if you like, but the export throws
}
```

**Ask:** the exported TS surface throws. `Ok`/`Err` may live inside
your implementation if you want to preserve the pattern internally,
but callers see thrown errors and null returns per interface contract.

Specifically:

- **`ResourceNotFoundException`** → return `null` from `get*` methods,
  don't throw. Every `get*` on the interface returns `T | null`.
- **`ConditionalCheckFailedException`** → throw a specific
  `ConflictError` class the caller can catch by type. Used at least by
  `stampPain008Built` (§7 in the previous doc); likely by future
  state-machine transitions.
- **`ProvisionedThroughputExceededException` /
  `RequestLimitExceeded`** → throw the raw AWS error; handlers surface
  as `503 ERR_UNAVAILABLE`.
- **Everything else** → throw. Handlers have a top-level catch that
  logs and returns `500 ERR_INTERNAL`.

Why this matters: `Db` interface is currently declared with throwing
promise return types. Every handler is written like:

```typescript
const user = await db.users.getByEmail(email);
if (user === null) return err404();
// ... use user
```

If it becomes:

```typescript
const result = await db.users.getByEmail(email);
if (result.isErr()) return err500(result.error);
if (result.unwrap() === null) return err404();
// ... use result.unwrap()
```

...every handler grows one wrapping-level and the null-vs-error branch
gets tangled. Not a dealbreaker but a lot of rewrites for a stylistic
preference we don't share on the TS side.

---

## Guardrail 3 — Local-dev backends stay alive

Backend has a `DbFactory` registry (`lib/src/storage/registry.ts` +
`index.ts`). At startup, the runtime dispatches by
`RAILBACK_STORAGE=memory | file | ddb`:

- `memory`: in-process map; used by every `.spec.ts` unit test.
- `file`: local JSON file, used by `run.sh` dev runs.
- `ddb`: real DynamoDB, used in AWS.

**Ask:** your TS connector is the `ddb` factory. It does not need to
know or care about `memory` and `file` — those already exist on the
backend side and stay ours. The registry picks one at boot.

This means:
- Your TS connector doesn't need to run without AWS credentials.
- Local dev keeps working without spinning up DynamoDB Local (though
  developers can still opt into `ddb` with `DYNAMODB_ENDPOINT_URL=...`
  matching your test conventions).
- Unit tests run against `memory`. Integration tests can pick a
  backend.

If your TS connector uses static imports of `@aws-sdk/*` at module load
time, it'd break the `memory`/`file` tests unless the SDK is a devDep
that ships regardless. Cleanest is a **lazy import** — the factory
function invokes `import("@aws-sdk/...")` on first call, not at file
parse. Not blocking; something to keep in mind.

---

## Guardrail 4 — No leaky abstractions

Your clarification says "the backend never sees physical attribute
names at all." Agreed and preferred. For that to hold under real code,
the TS connector must not:

- Return raw DDB item shapes (`{ pk: "USER#...", sk: "PROFILE", ... }`)
  from any method. Every return is a DTO — `User`, `Ticket`, etc. — as
  declared in `lib/src/types/dto.ts`.
- Expose GSI names in method signatures. No
  `queryByGsi(indexName: "gsi1", ...)` — methods are named by intent
  (`findByBarcodeUid`, `queryEmailPending`), and GSI choice is internal.
- Bleed `LastEvaluatedKey` through as a pagination cursor. Cursor is
  an **opaque string** — base64 of the key, or better, an internal
  reference. Callers round-trip it without inspection.
- Expose `ConditionExpression` / `UpdateExpression` / any raw DDB
  concept in method signatures. State transitions are named
  (`markSubmitted`, `markDebited`, `stampPain008Built`) and conditions
  are internal implementation details.

If any of these leak, the abstraction claim isn't real and the
"backend never sees physical names" promise breaks the moment someone
writes `if (item.pk.startsWith(...))` in a handler.

---

## Guardrail 5 — Delivery cadence + parallel-work fallback

Concrete concern: right now we can implement any `Db` method on
demand as we wire up a Lambda. Under the new plan, a method we need
gets added by you. If you're heads-down on something else, that
Lambda's wire-up blocks.

**Ask:** a rough turnaround commitment on requested methods.
Something like: **~48h from written request** for a method with a
clear signature, longer for methods with schema-shape questions.

**Fallback for anything longer than 48h:** we stub the method in
`lib/src/storage/ddb/stubs.ts` provisionally — enough to compile and
run local tests against `memory` — and swap in your real impl when it
lands. `stubs.ts` never runs in production; the `ddb` factory always
uses your connector. Stubs are just an unblock mechanism so we don't
gate every Lambda on your calendar.

If 48h feels tight, propose a number that works for you. The point is
having *any* agreement so a slow week doesn't stall the whole build.

---

## Guardrail 6 (small) — Package delivery mechanism, undecided

How does your TS connector reach our Lambda builds? Options:

- **Vendored directory** in the `railback` repo (e.g.
  `railback/backend/lib/vendor/railback-db-ts/`). Simple, no registry
  setup, but breaks if the DB team wants their own repo structure.
- **npm workspace package** inside `railback` (`packages/db-ts/`
  referenced as `"@railback/db": "workspace:*"`). Clean, but requires
  npm workspaces setup on the backend side — currently we're not
  workspaced.
- **Local file dep** in `package.json` (`"@railback/db":
  "file:../database/ts"`). Works if we co-locate the DB team's TS
  source in the same repo.

Not a blocker for the design conversation. Bring us a proposal when
you know how you want to structure your side.

**Constraint on our side:** whatever mechanism you pick has to work
inside our per-Lambda `BUILD.md` zip-and-upload workflow. No dynamic
downloads at Lambda boot. Everything the Lambda needs is baked into
the zip at build time.

---

## Consequences on the backend side

- `lib/src/storage/ddb/stubs.ts` becomes a placeholder for
  guardrail-5 provisional stubs. Downgraded from "will become real
  impl" to "unblock mechanism only."
- `lib/src/storage/ddb/keys.ts` is no longer authoritative. It may
  survive as a reference doc for the shapes your connector produces
  (useful for local debugging when we peek at DynamoDB Local through
  your `DYNAMODB_ENDPOINT_URL` setup), but the DB team owns the actual
  derivation. We'll add a comment at the top of that file marking it as
  reference-only.
- `lib/src/types/items.ts` stays. Those are TS types describing the
  DTO shapes handlers consume; they're not wire format even under the
  old plan. If your TS connector returns objects that don't match
  these DTOs, that's an interface violation to catch in review, not a
  type-file rewrite.
- Nothing on our `DbFactory` / `registry.ts` / `db()` layer changes.
  Your TS connector plugs in as the `ddb` factory.

---

## What changes on your side vs the clarification

Not much. Your clarification already says the TS connector will mirror
the Python one method-for-method. The guardrails above turn "mirror"
into a more specific contract:

1. Mirror against **our `Db` interface**, not against your Python
   shape. Method names, return types, error semantics as declared on
   the interface.
2. Do not export `Ok`/`Err` from the TS connector's public surface.
3. Do not expose DDB primitives (GSI names, `LastEvaluatedKey`,
   `ConditionExpression`, raw item shapes) in method signatures.

Everything else your Python connector already does — key shapes,
attribute names, GSI mappings — stays entirely inside your codebase.

---

## Locked on our side

`DECISIONS.md` on the `projektmanagement/` repo now has:

- **"DB team owns both Python and TypeScript connectors" (locked
  2026-07-05)** — captures the new arrangement + all six guardrails
  above. Supersedes the earlier same-day Option-C decision from this
  morning.
- The earlier "wire-format attribute names are lowercase" decision is
  partially superseded — the lowercase wire format is still true, but
  the backend no longer sees physical attribute names at all, so the
  "backend TS marshals uppercase↔lowercase" bit is dead.

---

## Open questions we still need from you

1. **Package delivery mechanism** — see guardrail 6. Propose when
   ready.
2. **Turnaround commitment on requested methods** — see guardrail 5.
   Propose a number.
3. **Timeline for first delivery.** Which methods do you plan to
   implement first, and roughly when? We are wiring `auth-handler`
   soon which needs `getByEmailForAuth`, `getByEmailAdminView`,
   `create` on `UserRepo`, and `getByEmailForAuth` on `AdminRepo` at
   minimum. If those are within your first-cut, great; if not, we
   stub per guardrail 5.

---

*Written by backend-side on 2026-07-05, alignment doc following the
`SCHEMA_CLARIFICATION_2026-07-05.md` offer to write both connectors.*
