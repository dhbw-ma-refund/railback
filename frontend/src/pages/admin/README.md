# Admin Panel

The admin panel lives under `/admin-panel/*` and shares the Vite dev server,
build pipeline, and design tokens with the main app. It is a read-mostly
management surface backed by the prod Lambda at
`https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws`
(or whatever `VITE_API_BASE_URL` points at). See `../../../..
/BACKEND_CONTRACT.md` in the backend branch for the full endpoint contract.

## Routes

- `/admin-panel/login` — email + password against `POST /auth/login`;
  role-gated (non-`ADMIN` refused, expired tokens redirected).
- `/admin-panel` — dashboard with user + ticket + refund KPIs and a state
  breakdown that deep-links into the pre-filtered ticket list.
- `/admin-panel/users` — user list with email + state filters, cursor
  pagination.
- `/admin-panel/users/:email` — user detail with recent tickets.
- `/admin-panel/tickets` — ticket list with state / email / train / date
  filters and cursor pagination.
- `/admin-panel/tickets/:ticketId` — ticket detail (journey plan vs. actual,
  extraction, status timeline, admin actions).
- `/admin-panel/tickets/:ticketId/delays?trainNr=&datum=` — segment-level
  delay drill-down against `GET /admin/trains/{trainNr}/{date}/delays`.

## Admin actions

State override lives in `StateOverrideDialog` on the ticket-detail page
and PATCHes `/admin/tickets/{ticketId}`. Rules:

- Only transitions from `services/transitions.ts` are rendered — everything
  else is either system-owned (`VALIDATING` / `READY` / `EMAIL_SENDING` /
  `EMAIL_FAILED`) or terminal (`COMPLETED` / `REJECTED` / `INVALID`). Both
  cases show distinct copy so admins know whether to wait for the pipeline
  or accept a final state.
- `db_paid_at` field appears only when the target is `APPROVED`.
- Admin note is required for `REJECTED` / `INVALID` (audit trail — money
  fields are immutable, so the note is the only recourse).
- 409 from the backend surfaces as "Übergang nicht erlaubt" inline; 403 as
  "Keine Berechtigung"; 5xx as a generic retry message.

`Verspätungen anzeigen` on the ticket detail is disabled when the ticket
payload lacks `fahrt_zugnummer_plan` or `fahrt_abreisedatum` so the button
never navigates to a dead page.

## Contract drift

`services/api/parse.ts` exposes `warnMissingField(context, field, raw)`
which fires one `console.warn` per `(context, field)` pair in `bun run
dev`, silent in production. Wired into ticket + user list/detail parsers
so a missing required field is loud during development. Deduped so a
50-row list emits one warning per field, not fifty.

## Development

```bash
cp .env.example .env.local
bun install
bun run dev        # http://localhost:5173/admin-panel
bun run lint       # eslint on src/pages/admin/**
bun run build      # tsc --noEmit && vite build
bun run test       # vitest run
```

`bun` is the local install runtime, but `npm` works interchangeably —
`package.json` scripts are portable.
