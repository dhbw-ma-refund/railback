# Backend Connection

The frontend now talks directly to the deployed AWS Lambda backend.

- **Base URL**: `VITE_API_BASE_URL` in `frontend/.env.local` (see
  `frontend/.env.example` for the canonical value).
- **User client**: `frontend/src/lib/api/client.ts` — constructs the
  user-facing API client via the shared factory. Wire uses
  localStorage-backed token storage (`frontend/src/lib/auth/storage.ts`)
  and redirects to `/login` on refresh failure.
- **Admin client**: `frontend/src/pages/admin/services/api/client.ts` —
  same shared factory, sessionStorage-backed, redirects to
  `/admin-panel/login`.
- **Shared transport**: `frontend/shared/api/createClient.ts` —
  single-flight 401 refresh + typed fetch. `frontend/shared/api/errors.ts`
  and `frontend/shared/api/jwt.ts` are the canonical error taxonomy and
  JWT decode helper used by both clients.

The mock stack (`src/mocks/`, `src/api/client.js`, `src/lib/mockAPI.ts`,
`src/lib/mockInterceptor.ts`, `src/contexts/AuthContext.jsx`,
`src/pages/Dashboard.jsx`) has been removed.

## Local development

```
cp frontend/.env.example frontend/.env.local
cd frontend && npm run dev   # or bun dev
```

The shared client falls back to the production Lambda URL when
`VITE_API_BASE_URL` is unset, so `.env.local` is only needed to point
at a different environment.
