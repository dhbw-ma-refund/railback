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
- `/admin-panel/users/:email` — user detail with recent tickets and an
  `Bearbeiten` action for profile + status edits.
- `/admin-panel/tickets` — ticket list with state / email / train / date
  filters and cursor pagination.
- `/admin-panel/tickets/:ticketId` — ticket detail (journey plan vs. actual,
  extraction, status timeline, admin actions).
- `/admin-panel/tickets/:ticketId/delays?trainNr=&datum=` — segment-level
  delay drill-down against `GET /admin/trains/{trainNr}/{date}/delays`.
- `/admin-panel/sepa` — SEPA operator queue: lists pending pain.008 batches
  with a presigned XML download, mark-submitted per batch, and a bank-report
  upload that goes directly to S3 via presigned POST.

## Admin actions

`Verspätungen anzeigen` on the ticket detail is disabled when the ticket
payload lacks `fahrt_zugnummer_plan` or `fahrt_abreisedatum` so the button
never navigates to a dead page. `pain.008 neu erzeugen` is enabled only
when the ticket is `APPROVED` and no pain.008 has been built yet.

User profile + status editing lives in `UserEditDialog` on the user-detail
page and PATCHes `/admin/users/{email}`:

- Editable fields: `vorname`, `nachname`, `telefon`, `adresse` (whole
  object), `user_state`. `iban` / `bic` are read-only — the user detail
  page surfaces them under a Bankverbindung section, but the PATCH
  endpoint continues to reject those keys and always will.
- Only reachable transitions from `services/transitions.ts` are rendered;
  same-state saves are blocked because the backend replies `400 no-op patch
  — at least one field must change`.
- `ACTIVE → SUSPENDED` requires a `Sperrgrund` textarea; Save stays
  disabled until it is filled (client-side mirror of the backend rule).
- PATCH payload is the *diff*: unchanged fields are never sent, so a
  no-change save is impossible.
- 400 from the backend surfaces its own message verbatim so admins see
  which field the server rejected; 409 / 403 / 5xx map to the same copy
  as the ticket dialog.

## Contract drift

`services/api/parse.ts` exposes `warnMissingField(context, field, raw)`
which fires one `console.warn` per `(context, field)` pair in `bun run
dev`, silent in production. Wired into ticket + user list/detail parsers
so a missing required field is loud during development. Deduped so a
50-row list emits one warning per field, not fifty.

## Layout

The panel targets three viewport bands. The shared component library
has no viewport rules of its own, so the admin panel owns its own
responsive rules.

- **Phone (up to 767 px wide)**: tables collapse to labelled card rows,
  the filter bar stacks vertically with a collapse toggle, and the
  header nav wraps under the brand + logout row. Rules live in
  `mobile.css` and the `@media (max-width: 767px)` block inside each
  screen's CSS.
- **Tablet and small laptop (768 – 1023 px)**: default layout — 24 px
  outer padding, auto-fit grids with 180 – 220 px minimum tracks,
  detail pages capped at 1200 px, dashboard at 1400 px, list pages
  filling the shell.
- **Desktop landscape (1024 px and up)**: outer padding grows to 32 px
  so content stops hugging the viewport edge, the detail field grid
  widens to 240 px tracks (four columns on a 1440 px monitor), and the
  dashboard KPI row widens to 220 px tracks. Every page container
  (list shell, dashboard, detail, and the inner header row) caps at
  1400 px and centers with `margin: 0 auto`, so the header nav aligns
  with the first column of page content on ultra-wide monitors. The
  deep-blue header bar itself stays full-bleed via a wrapper element
  so it reaches the viewport edges on 2560 px displays without leaving
  the nav marooned on the left.

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
