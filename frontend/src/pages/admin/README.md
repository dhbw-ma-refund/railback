# Admin Panel

The admin panel lives under `/admin-panel/*` and shares the Vite dev server,
build pipeline, and design tokens with the main app. It is a read-only
management surface backed by the mock backend at `http://localhost:16704/v1`
(or whatever `VITE_API_BASE_URL` points at).

## Routes

- `/admin-panel/login` — login form
- `/admin-panel` — dashboard placeholder
- `/admin-panel/users` — user list, filter, cursor pagination
- `/admin-panel/users/:email` — user detail with recent tickets
- `/admin-panel/tickets` — ticket list with state badges, filters, cursor pagination
- `/admin-panel/tickets/:ticketId` — ticket detail with journey/status sections
- `/admin-panel/tickets/:ticketId/delays` — stub for delay drill-down (WP #478)

## Development

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:5173/admin-panel
npm run lint
npm run build
npm run test
```
