# RailBack Backend

Backend application server for the RailBack group project (Matrikel 1334001).
npm workspaces monorepo, Node 20.x. Polyglot per-lambda runtimes are allowed
(Python 3.12 for `ticket-extractor` / `ingest-delays`), but the workspace
tooling here is Node-only — Python lambdas ship with their own `requirements.txt`
and `BUILD.md` next to their source.

## Run

The npm workspace lives under `backend/`. There is a thin pass-through
`package.json` at the repo root that delegates `test` / `lint` /
`typecheck` / `check` into here, so both of the following work:

```
# from repo root
npm run install:backend     # one-time hydrate
npm test                    # delegates to backend/
npm run typecheck           # delegates to backend/
npm run check               # typecheck + lint + test

# from backend/
npm install
npm test
npm run typecheck           # forwards to every sub-workspace
npm run lint
npm run check
```

`npx tsc -p lib/tsconfig.json --noEmit` only works from `backend/`, not
from the repo root — `lib/` lives under `backend/lib/`. Use the pass-through
script (`npm run typecheck`) when you want a working command from the
project root.

## Contracts

Source of truth lives one level up, not in this directory:

- `../CLAUDE.md` — locked product + tech decisions, the working contract
- `../ARCHITECTURE.md` — lambda layout, repos, payment flow
- `../IMPLEMENTATION_PLAN.md` — phased build order, mocking strategy
- `../DB_SCHEMA.md`, `../API_CONTRACT_*.md`, `../SEPA_PAIN008.md`,
  `../REFUND_FORM_FIELDS.md`, `../INGEST_DELAYS.md`, `../DECISIONS.md`

If code disagrees with `CLAUDE.md`, the doc wins until `DECISIONS.md`
records the change.

## Storage

Dev + test default: `RAILBACK_STORAGE=memory` (in-process, no AWS). `file`
is available for manual fixture work. Deploy default: `RAILBACK_STORAGE=ddb`,
set by the lambda env. Storage backend is selected behind
`@railback/lib/storage` so call-sites never branch on it.

## Phase

Phase 1 complete (foundation + auth + crypto + zod + mocks + refund +
SEPA + route-lookup). Phase 2 (Lambdas) is next. See
`../PROGRESS.md` and `../IMPLEMENTATION_PLAN.md`.
