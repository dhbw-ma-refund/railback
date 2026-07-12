# RailBack Frontend

Vite + React + TypeScript. Ships two surfaces from a single dev server:

- **Landing + user forms** — `/`, `/user`, `/faq`, `/legal`, etc.
- **Admin panel** — `/admin-panel/*` (see `src/pages/admin/README.md` for
  routes, contracts, and admin actions).

Both share the design tokens and primitives in `shared/`.

## Development

```bash
cp .env.example .env.local
bun install
bun run dev        # http://localhost:5173
bun run lint       # eslint on src/pages/admin/**
bun run build      # tsc --noEmit && vite build
bun run test       # vitest run
```

`VITE_API_BASE_URL` points the admin panel at the backend Lambda. The
default in `.env.example` is the prod URL so `bun run dev` works without
extra setup.

## Admin panel

Under `/admin-panel/*`:

- `/admin-panel/login` — admin login (role-gated).
- `/admin-panel` — dashboard with KPIs and state drill-down.
- `/admin-panel/users` and `/users/:email` — user list + detail.
- `/admin-panel/tickets` and `/tickets/:ticketId` — ticket list + detail
  with a state-override dialog and delay drill-down.

See `src/pages/admin/README.md` for the full contract.
