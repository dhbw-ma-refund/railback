# API Contract — Frontend `userforms`

For Matrikel **3992195** and **5407182** (User Forms).
Companion to the backend (Matrikel 1334001). Source of truth for what the user-facing app calls. EU-form decisions baked in; no `geschlecht`/`anrede`; no email-verify; no forgot-password; FAQ is static / frontend-only).

---

## Conventions

- **Base URL**: `https://api.railback.example/v1` (placeholder — gets pinned when API Gateway URL is known)
- **Transport**: HTTPS, JSON, UTF-8. `Content-Type: application/json` on every request body except where called out.
- **Auth**: `Authorization: Bearer <accessToken>` on every route except `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`.
- **Time**: ISO-8601 with timezone (e.g. `2026-06-12T14:33:00+02:00`). Dates without time are `YYYY-MM-DD`.
- **Money**: decimal as string (`"42.50"`) — currency is implicit EUR.
- **Pagination**: opaque `cursor` string. Pass back verbatim on the next request. `null` / absent = no more pages.
- **IDs**: `ticketId` is a ULID. **The Antragsnummer the user sees in D10 is the `ticketId`** — there is no separate `REQ-…` namespace. Frontend can format it for display (`REQ-` prefix is fine), but always send the raw ULID back.
- **Errors**: every non-2xx returns the envelope below. Render `message` to the user; switch on `code` for behaviour.

```json
{ "code": "ERR_VALIDATION", "message": "telefon ist Pflicht", "details": { "field": "telefon" } }
```

Common codes: `ERR_VALIDATION`, `ERR_AUTH_INVALID`, `ERR_AUTH_EXPIRED`, `ERR_FORBIDDEN`, `ERR_NOT_FOUND`, `ERR_CONFLICT` (e.g. duplicate barcode), `ERR_INTERNAL`.

See full contract in this file for all endpoints.
