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

---

## Authentication

### `POST /auth/register`

D02 wireframe submits everything in one call (the multi-step wizard is purely frontend state). No email verification — user lands `ACTIVE`.

Required: everything the EU-form needs as Pflichtfelder, so the wizard collects it now and the refund flow doesn't have to chase it later.

**Request**
```json
{
  "email": "maria.mueller@example.de",
  "password": "min-8-zeichen",
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 1234567",
  "adresse": {
    "strasse": "Musterstraße",
    "hausnr": "12a",
    "plz": "68161",
    "ort": "Mannheim",
    "land": "DE"
  },
  "iban": "DE89 3704 0044 0532 0130 00",
  "bic": "COBADEFFXXX",
  "datenschutz_einwilligung": true,
  "agb_akzeptiert": true
}
```

**Response 201**
```json
{
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…",
  "expiresIn": 900,
  "user": { "email": "maria.mueller@example.de", "vorname": "Maria", "nachname": "Müller", "role": "USER" }
}
```

Notes:
- `password`: min 8 chars; backend bcrypt-hashes. Frontend just passes through.
- `iban`/`bic`: optional in the request — user can postpone via the registration wireframe's "Bankdaten" step. If omitted, store empty; user can fill in later via `PATCH /users/me/bank` before submitting a refund. Refund submission will fail if still missing.
- `datenschutz_einwilligung` and `agb_akzeptiert`: must be `true`. Backend rejects otherwise.
- Errors: `ERR_VALIDATION` (bad email/password/missing fields), `ERR_CONFLICT` (email already registered).

### `POST /auth/login`

Same endpoint for users and admins. Frontend doesn't need to know which it'll hit — backend dispatches by role on the response. **For userforms, only `role === "USER"` is expected**; if you ever see `"ADMIN"` (because someone reused an admin email), redirect to the admin frontend.

**Request**
```json
{ "email": "maria.mueller@example.de", "password": "…" }
```

**Response 200**
```json
{
  "accessToken": "eyJ…",
  "refreshToken": "eyJ…",
  "expiresIn": 900,
  "user": { "email": "…", "vorname": "Maria", "nachname": "Müller", "role": "USER" }
}
```

Errors:
- `ERR_AUTH_INVALID` — wrong creds; deliberately doesn't distinguish "no such email" vs "wrong password".
- `ERR_FORBIDDEN` — account is `SUSPENDED` or `DELETION_SCHEDULED`. Response includes `details.user_state` and, for `SUSPENDED`, `details.suspended_reason` (free text from admin). Frontend should show:
  - `SUSPENDED` → "Dein Konto wurde gesperrt: <reason>. Bitte wende dich an den Support."
  - `DELETION_SCHEDULED` → "Dein Konto wird gerade gelöscht. Eine Anmeldung ist nicht möglich."

  In both cases, do **not** keep retrying or offer "passwort vergessen" — neither will help. The user has to contact support out-of-band.

### `POST /auth/refresh`

**Request**: `{ "refreshToken": "eyJ…" }`
**Response 200**: same shape as login. Refresh token rotates — replace the stored one with the new one returned. Old one stops working immediately.

Errors:
- `ERR_AUTH_EXPIRED` — refresh token is invalid or expired; force re-login.
- `ERR_FORBIDDEN` — the underlying account is now `SUSPENDED` or `DELETION_SCHEDULED`. Same handling as on login: drop tokens, show the suspension/deletion message, do not retry. This means existing sessions terminate within one access-token TTL (~15 min) of an admin ban.

### Logout

No server call. Drop both tokens from storage. (No `/auth/logout` endpoint — refresh tokens expire on their own; there's no revocation list in MVP.)

---

## User profile (D02 → D03 → D07/D08 edits)

### `GET /users/me`

The general profile view. **No** `iban`/`bic` here — those go through `/users/me/refund-data` (deliberately separate so accidental display of bank data never happens on the dashboard).

**Response 200**
```json
{
  "email": "maria.mueller@example.de",
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 1234567",
  "adresse": {
    "strasse": "Musterstraße", "hausnr": "12a",
    "plz": "68161", "ort": "Mannheim", "land": "DE"
  },
  "user_state": "ACTIVE",
  "created_at": "2026-04-01T10:00:00+02:00"
}
```

`user_state`: `"ACTIVE"` is the only value the user app ever sees here. (`SUSPENDED` and `DELETION_SCHEDULED` accounts can't reach this endpoint — login is rejected for them; see `POST /auth/login` errors. `UNVERIFIED` was in earlier drafts but is unreachable in the MVP — no email verification, users land in `ACTIVE` directly.)

### `PATCH /users/me`

Partial update. Only send the fields the user actually changed.

**Request** (any subset):
```json
{
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 9999999",
  "adresse": { "strasse": "…", "hausnr": "…", "plz": "…", "ort": "…", "land": "DE" }
}
```
Address is replaced wholesale if sent — send all five fields together, not just one.

**Response 200**: full `GET /users/me` shape.

### `GET /users/me/refund-data`

Exactly the field set the EU reimbursement form needs (Section 5). Use this when populating the "Persönliche Daten" + "Auszahlung" wizard steps with prefilled values.

**Response 200**
```json
{
  "vorname": "Maria",
  "nachname": "Müller",
  "email": "maria.mueller@example.de",
  "telefon": "+49 151 1234567",
  "adresse": { "strasse": "…", "hausnr": "…", "plz": "…", "ort": "…", "land": "DE" },
  "iban": "DE89 3704 0044 0532 0130 00",
  "bic": "COBADEFFXXX"
}
```

`iban` and `bic` come back **decrypted** (this is the user's own data, not the admin view). If user hasn't set them, both fields are `null` — frontend must collect them before letting the user submit the refund.

### `PATCH /users/me/bank`

Update IBAN + BIC. Both fields together — partial bank updates aren't allowed (BIC without IBAN is meaningless).

**Request**: `{ "iban": "…", "bic": "…" }`
**Response 200**: `{ "iban": "…", "bic": "…" }` (echo of stored value)

### `DELETE /users/me`

Schedules deletion (`user_state` → `DELETION_SCHEDULED`, profile TTL'd to +30d, tickets anonymised but kept 10y for `COMPLETED`/`APPROVED` records). Frontend should confirm with a hard "Konto löschen?" dialog.

**Request**: `{ "confirmPassword": "…" }` — current password, re-checked
server-side before the deletion is scheduled. Defence against a stolen
access token being used for one-click account erasure.

**Response 204**. Tokens stay valid until refresh fails — frontend should log out immediately after.

Errors:
- `ERR_AUTH_INVALID` — `confirmPassword` is wrong.
- `ERR_FORBIDDEN` — account is `SUSPENDED`. Suspended users can't self-delete to dodge the ban / audit trail; admin must escalate manually. (In practice the user wouldn't reach this endpoint anyway — login is already rejected for `SUSPENDED` accounts. Listed here for completeness.)

---

## Refund flow (D04 → D10)

The whole wizard is **frontend state** until the very last submit. The intermediate calls (`upload`, `delays`) only return data for display — nothing persists as a "draft application" on the backend. If the user closes the app mid-wizard, they start over.

### Step 1 — Upload ticket (D04)

The frontend reads the file (PDF/JPG/PNG), base64-encodes it, and POSTs.

#### `POST /users/me/tickets/{ticketId}/upload`

`ticketId`: **frontend generates a ULID** before this call and reuses it through the whole wizard. (Backend accepts client-supplied ULIDs to keep the wizard idempotent — re-posting with the same id replaces the raw ticket payload, so retries on flaky uploads are safe.)

**Request**
```json
{
  "filename": "ticket.pdf",
  "mimeType": "application/pdf",
  "data": "JVBERi0xLjQKJ…"
}
```

`data`: base64 of the file bytes. Soft cap 250 KB pre-encoding (frontend warns), hard cap 290 KB (backend rejects with `ERR_VALIDATION`). No chunking — files above the hard cap must be compressed/re-photographed.
`mimeType`: `application/pdf` | `image/jpeg` | `image/png`.

**Response 202**
```json
{
  "ticketId": "01J9X…",
  "extraction_status": "PROCESSING"
}
```

The DDB Streams trigger fires the `ticket-extractor` Lambda asynchronously. Frontend polls (next call) until `extraction_status` is final.

#### `GET /users/me/tickets/{ticketId}`

Polled while extraction is running. Returns the same shape as below — frontend reads `extraction_status` and either shows a spinner, advances to D05 with prefilled fields, or shows the manual-entry path.

**Response 200**
```json
{
  "ticketId": "01J9X…",
  "ticket_state": "PENDING_DB_PAYMENT",
  "extraction_status": "DONE",
  "extraction_method": "BARCODE",
  "extraction_confidence": 1.0,
  "barcode_uid": "118XYZ…",
  "email_status": "DELIVERED",
  "email_failed_reason": null,
  "fahrt": {
    "abreisedatum": "2026-05-12",
    "abreisebahnhof": "Mannheim Hbf",
    "zielbahnhof": "Karlsruhe Hbf",
    "abfahrtszeit_plan": "14:22",
    "ankunftszeit_plan": "14:56",
    "zugnummer_plan": "IC 2345",
    "zugkategorie_plan": "IC",
    "fahrkartennummer": "AB12345678",
    "fahrkartenpreis": "29.90"
  },
  "vorname_aus_ticket": "Maria",
  "nachname_aus_ticket": "Müller",
  "uploaded_at": "2026-06-11T18:04:00+02:00"
}
```

States to handle in the UI:

| `extraction_status` | What to show |
|---|---|
| `PROCESSING` | Spinner. See "Polling cadence" below. |
| `DONE` + `extraction_method` `"BARCODE"`/`"PDF_TEXT"` | Advance to D05 with `fahrt.*` prefilled. User reviews/edits. |
| `DONE` + `extraction_method` `"MANUAL"` | Advance to D05 with **empty fields**. User types everything by hand. (`extraction_confidence: 0.0`.) |
| `FAILED` | Backend gave up (e.g. corrupt PDF). Show error, let user re-upload. |

**Polling cadence** (same shape used everywhere we poll the backend —
extraction here, `email_status` after submit): initial 800 ms wait → 1.5 s
exponential backoff capped at 4 s → 45 s hard timeout → "dauert länger als
gewohnt" message. After the hard timeout, the backend is still working
(extractor / sweeper); the UI just stops auto-polling. For extraction the
user can manually retry; for email there is no manual retry (the sweeper
owns it — see "Step 5 — Submit").

`ticket_state` lifecycle relevant to the user app:
`VALIDATING` (just uploaded) → `READY` (extraction done, awaiting submit) →
`EMAIL_SENDING` (refund submitted, email send in flight) →
`PENDING_DB_PAYMENT` (email confirmed delivered, awaiting DB-side payment
confirmation) → `APPROVED` / `REJECTED` / `COMPLETED` (admin-side outcomes).
Failure paths: user-initiated `DELETE` → `INVALID`; email delivery failure
→ `EMAIL_FAILED` (terminal).

`barcode_uid`: when present, the backend has already checked for duplicate uploads of the same ticket. If a duplicate is detected on upload, the call returns `409 ERR_CONFLICT` with `details.existing_ticket_id` so the frontend can route the user to the existing record instead of creating a new one.

### Step 2 — Reisedaten prüfen (D05)

Pure frontend: user reviews/edits `fahrt.*` from the previous response. No API call. Save the edited values in component state.

### Step 3 — Verspätung prüfen (D06)

#### `POST /users/me/tickets/{ticketId}/delays`

Looks up Train Segment Delays for the trip. **Read-only** — does not persist anything; frontend caches the response for the rest of the wizard.

**Request**
```json
{
  "trainNr": "IC 2345",
  "date": "2026-05-12",
  "abreisebahnhof": "Mannheim Hbf",
  "zielbahnhof": "Karlsruhe Hbf"
}
```

**Response 200**
```json
{
  "trainNr": "IC 2345",
  "date": "2026-05-12",
  "segments": [
    {
      "segId": "8000244-8000191",
      "origin": "Mannheim Hbf",
      "destination": "Karlsruhe Hbf",
      "delayMinutes": 65,
      "reason": "Stellwerksstörung",
      "is_cancelled": false,
      "abfahrtszeit_plan": "14:22",
      "abfahrtszeit_tatsaechlich": "15:27",
      "ankunftszeit_plan": "14:56",
      "ankunftszeit_tatsaechlich": "16:01"
    }
  ],
  "maxDelayMinutes": 65,
  "any_cancelled": false,
  "suggested_antragsart": "ENTSCHAEDIGUNG_60_119"
}
```

`suggested_antragsart`: backend's auto-derivation from `maxDelayMinutes` + `antragsgrund` choices. Frontend uses it as the default selection in the "Problem auswählen" step but lets the user override (especially needed for `KOSTEN_ALTERNATIVTRANSPORT`).

Possible values:
- `"ERSTATTUNG_FAHRKARTE"`
- `"ENTSCHAEDIGUNG_60_119"` (60–119 min delay)
- `"ENTSCHAEDIGUNG_120_PLUS"` (≥120 min)
- `"ENTSCHAEDIGUNG_ZEITKARTE"` (Zeitkarten case — user must opt in)
- `"KOSTEN_ALTERNATIVTRANSPORT"` (Bus/Taxi/Hotel — user must opt in, requires belege upload)

If `segments` is empty, the train wasn't covered by the delay archive (gap in `ingest-delays` coverage). UI should warn the user; they can still submit but the delay will be Section 3.3 manual entry.

### Step 4 — Belege upload (optional, only for `KOSTEN_ALTERNATIVTRANSPORT`)

#### `POST /users/me/tickets/{ticketId}/belege`

**Request**
```json
{ "filename": "taxi-rechnung.pdf", "mimeType": "application/pdf", "data": "JVBE…" }
```

**Response 200**: `{ "belegId": "01J9Y…" }`

Multiple Belege per ticket allowed — call once per file. 6mo retention via DDB TTL on the attribute (handled by backend).

#### `DELETE /users/me/tickets/{ticketId}/belege/{belegId}`

Remove a wrong upload before submission. Allowed only while the ticket is
in `VALIDATING` or `READY` — once the refund is submitted, belege are
already attached to the email and can't be retracted.

**Response 204**.

Errors:
- `ERR_NOT_FOUND` if `belegId` doesn't exist or doesn't belong to this ticket.
- `ERR_CONFLICT` if `ticket_state` is past `READY` (`EMAIL_SENDING`,
  `PENDING_DB_PAYMENT`, `APPROVED`, `COMPLETED`, `REJECTED`,
  `EMAIL_FAILED`). `details.current_state` is included so the frontend can
  show "Belege können nach Antragsstellung nicht mehr entfernt werden."

### Step 5 — Submit (D09)

#### `POST /users/me/tickets/{ticketId}/refund`

The single persistence point. Everything the user typed/picked through the wizard goes here.

**Request**
```json
{
  "antragsgrund": ["VERSPAETUNG"],
  "antragsart": "ENTSCHAEDIGUNG_60_119",
  "fahrt": {
    "abreisedatum": "2026-05-12",
    "abreisebahnhof": "Mannheim Hbf",
    "zielbahnhof": "Karlsruhe Hbf",
    "abfahrtszeit_plan": "14:22",
    "ankunftszeit_plan": "14:56",
    "zugnummer_plan": "IC 2345",
    "zugkategorie_plan": "IC",
    "fahrkartennummer": "AB12345678",
    "fahrkartenpreis": "29.90"
  },
  "fahrt_tatsaechlich": {
    "ankunftsdatum_tatsaechlich": "2026-05-12",
    "abfahrtszeit_tatsaechlich": "15:27",
    "ankunftszeit_tatsaechlich": "16:01",
    "zugnummer_tatsaechlich": "IC 2345",
    "verpasster_anschluss_bahnhof": null
  },
  "antragstellung_ort": "Mannheim",
  "zusaetzliche_angaben": null,
  "datenschutz_einwilligung": true,
  "wahrheitserklaerung": true
}
```

Field rules:
- `antragsgrund`: array, ≥1 entry. Values: `"VERSPAETUNG" | "AUSFALL" | "VERPASSTER_ANSCHLUSS"` (multi-select from D06).
- `antragsart`: single value (see enum above).
- `fahrt.*`: most fields prefilled from extraction, all editable.
- `fahrt_tatsaechlich.*`: most fields prefilled from `/delays` response, editable. `verpasster_anschluss_bahnhof` only when `antragsgrund` includes `"VERPASSTER_ANSCHLUSS"`, else `null`.
- `antragstellung_ort`: Pflicht. Default to user's `adresse.ort`.
- `zusaetzliche_angaben`: optional free text, max 2500 chars.
- `datenschutz_einwilligung` and `wahrheitserklaerung`: both must be `true`. Backend hard-rejects on `false`.
- The user's `vorname`/`nachname`/`adresse`/`telefon`/`iban`/`bic`/`email` are pulled server-side from the profile — do **not** send them in the body. Frontend should call `PATCH /users/me` and `PATCH /users/me/bank` first if anything is stale.

**Response 202**
```json
{
  "ticketId": "01J9X…",
  "ticket_state": "EMAIL_SENDING",
  "submitted_at": "2026-06-11T19:00:00+02:00",
  "email_status": "SENT",
  "erwartete_erstattung": "29.90",
  "service_fee_betrag": "5.00"
}
```

(`service_fee_betrag` value is a placeholder — the fee formula is OPEN; flat / percentage / tiered yet to be decided. See CLAUDE.md "Open".)

`erwartete_erstattung` and `service_fee_betrag` are computed and locked at
this submit. They drive the EU-form Section 5 fields and the SEPA
mandate's `fee_amount` respectively. Neither value can be changed
afterwards by user or admin — if either turns out to be wrong, the
ticket can only be rejected and a new application started.

After this call, the backend renders the EU-form PDF (and SEPA mandate)
and sends it to the user's email via Resend. **There is no PDF download
endpoint and no resend button** — the email is the only artefact the user
receives. Frontend polls `GET /users/me/tickets/{ticketId}` until
`email_status` reaches a terminal value:
- `DELIVERED` → ticket is now `PENDING_DB_PAYMENT`. Show success.
- `BOUNCED` / `FAILED` → ticket is now `EMAIL_FAILED` (terminal). Show
  "Versand fehlgeschlagen, bitte starte einen neuen Antrag."

The backend retries internally (3 attempts over ~15 min); the frontend
should not prompt the user to retry manually. Polling cadence is the
same as extraction (see "Polling cadence" earlier in this doc): initial
800 ms → 1.5 s exponential backoff capped at 4 s → 45 s hard timeout →
"dauert länger als gewohnt" message without a retry action (the sweeper
is still working).

Errors:
- `ERR_VALIDATION` (DSGVO unchecked, missing field, IBAN/BIC missing on profile)
- `ERR_CONFLICT` (`ticket_state !== "READY"` — submission is only valid
  after extraction finishes; if extraction is still running, the wizard
  shouldn't have got here)

### Step 6 — Bestätigung (D10)

After `POST /refund`, the rendered EU-form (and SEPA mandate) is sent to
the user's email by the backend. **There is no PDF download endpoint** —
the email is the canonical artefact. Frontend polls
`GET /users/me/tickets/{ticketId}` after submit to track delivery.

`email_status` lifecycle:

| `email_status` | What it means | UI |
|---|---|---|
| `SENDING` | Backend is mid-call to Resend (rare; usually skipped) | spinner |
| `SENT` | Resend accepted the API call, awaiting recipient MX confirmation | spinner |
| `DELIVERED` | Recipient MX accepted; ticket transitions to `PENDING_DB_PAYMENT` | success — "Antrag wurde an deine E-Mail gesendet." |
| `BOUNCED` | Recipient MX rejected (full mailbox, address invalid, etc.); ticket → `EMAIL_FAILED` | error — "Versand fehlgeschlagen. Bitte starte einen neuen Antrag." |
| `FAILED` | Backend gave up after 3 retries OR webhook never arrived within 24h; ticket → `EMAIL_FAILED` | same as `BOUNCED` |

`email_failed_reason` accompanies `EMAIL_FAILED` and is one of
`"max_retries" | "bounced" | "complained" | "webhook_timeout"`.
Frontend may surface a slightly different message per reason but isn't
required to.

The Antragsnummer shown in D10 is just the `ticketId` — frontend formats it
as `REQ-2026-…` for display if you want, but the underlying value is the
ULID.

---

## Dashboard (D03)

### `GET /users/me/tickets`

List the user's applications. No pagination needed — typical user has < 20.

**Response 200**
```json
{
  "items": [
    {
      "ticketId": "01J9X…",
      "ticket_state": "PENDING_DB_PAYMENT",
      "abreisedatum": "2026-05-12",
      "abreisebahnhof": "Mannheim Hbf",
      "zielbahnhof": "Karlsruhe Hbf",
      "fahrkartenpreis": "29.90",
      "antragsart": "ENTSCHAEDIGUNG_60_119",
      "erwartete_erstattung": "29.90",
      "email_status": "DELIVERED",
      "submitted_at": "2026-06-11T19:00:00+02:00",
      "updated_at": "2026-06-11T19:00:00+02:00"
    }
  ]
}
```

`fahrkartenpreis` is the price the user originally paid for the ticket;
`erwartete_erstattung` is the locked-at-submit refund amount they're
asking DB for (often equal to `fahrkartenpreis` for `ERSTATTUNG_FAHRKARTE`,
but a fixed compensation amount for `ENTSCHAEDIGUNG_*`). Show whichever
fits the UI — the dashboard cards typically lead with `erwartete_erstattung`
post-submit.

`erwartete_erstattung` is only set after `POST /refund` (i.e. `ticket_state >= EMAIL_SENDING`); for tickets still in `VALIDATING` or `READY`, omit it.

`email_status` is included so the dashboard can distinguish in-flight from
delivered tickets without a per-row fetch. Same enum as on the detail
endpoint (`SENDING | SENT | DELIVERED | BOUNCED | FAILED`); omit for
tickets that haven't reached `EMAIL_SENDING` yet.

`ticket_state` enum (user-visible):

| Value | Display |
|---|---|
| `VALIDATING` | "Wird geprüft" (extraction running) |
| `READY` | "Bereit zum Absenden" (mid-wizard, abandoned) |
| `EMAIL_SENDING` | "Antrag wird per E-Mail versendet" |
| `PENDING_DB_PAYMENT` | "Antrag gestellt — wartet auf DB-Zahlung" |
| `APPROVED` | "Bewilligt" |
| `REJECTED` | "Abgelehnt" |
| `COMPLETED` | "Abgeschlossen" (Auszahlung erfolgt) |
| `EMAIL_FAILED` | "Versand fehlgeschlagen — bitte neuen Antrag stellen" |
| `INVALID` | "Gelöscht" — only shown if user undoes deletion in the same session |

### `DELETE /users/me/tickets/{ticketId}`

Soft delete. Sets `ticket_state` → `INVALID`, TTL +90d. Frontend should hide invalid tickets from the dashboard by default.

**Response 204**.

Errors: `ERR_CONFLICT` if `ticket_state` is anything other than
`VALIDATING` or `READY`. Once the user submits the refund
(`EMAIL_SENDING` and beyond), the email artefact is in flight or
already in the user's inbox and the ticket carries DB-side review
implications — soft-delete from there isn't a meaningful operation.
Terminal states (`COMPLETED`, `APPROVED`, `REJECTED`, `EMAIL_FAILED`,
`INVALID`) are equally rejected. `details.current_state` carries the
actual state so the frontend can surface a tailored message.

---

## Things you do NOT call

These were in older drafts of the Fachkonzept and have been **dropped**:

- `POST /auth/verify-email` — no email verification flow
- `POST /auth/forgot-password` — no password reset (locked-in product decision)
- `GET /faq` — FAQ is static frontend content, no backend
- Anything mentioning `geschlecht`, `anrede`, `titel`, `firma`, `geburtsdatum`, `bahncard100Nr`, `zeitkartenNr` — all dropped from the schema
- `POST /admin/auth/login` — admin login uses the same `POST /auth/login` (irrelevant for userforms anyway)

---

## Open items (pin down with backend before integration freeze)

1. Whether to surface `extraction_confidence < 1.0` (PDF-text path) as a banner ("bitte alle Felder prüfen") in D05.
2. ~~Soft cap on file size for `/upload`~~ — locked: 250 KB soft / 290 KB hard, no chunking. (Driven by the 400 KB DDB item ceiling.)
3. Email sender displayed name + From address — currently `onboarding@resend.dev` placeholder; production multi-recipient demo requires a verified domain. Confirm before integration freeze.
