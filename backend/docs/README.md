# RailBack API — Examples

Request/response example for every endpoint. Authoritative shapes live in
`../schema/openapi.yaml`; the full rendered reference is `api.html`. 
This file is examples only.

- **Base URL:** `https://{apiId}.execute-api.eu-north-1.amazonaws.com`
- **Auth:** `Authorization: Bearer <accessToken>` on everything except the
  three `/auth/*` endpoints.
- **Conventions:** amounts are decimal strings (`"29.90"`, `"0.75"`);
  timestamps are ISO-8601 with offset (`"2026-06-11T19:00:00+02:00"`);
  dates `YYYY-MM-DD`; times `HH:MM`; ids are ULIDs.

---

## Auth

### POST /auth/register

```json
// → 201
{
  "email": "maria.mueller@example.de",
  "password": "min8charpass123",
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 1234567",
  "adresse": { "strasse": "Musterstraße", "hausnr": "12a", "plz": "68161", "ort": "Mannheim", "land": "DE" },
  "iban": "DE89370400440532013000",
  "bic": "COBADEFFXXX",
  "datenschutz_einwilligung": true,
  "agb_akzeptiert": true
}
```

```json
{
  "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "expiresIn": 900,
  "user": { "email": "maria.mueller@example.de", "vorname": "Maria", "nachname": "Müller", "role": "USER" }
}
```

### POST /auth/login

```json
// → 200 (response shape identical to /auth/register)
{ "email": "maria.mueller@example.de", "password": "min8charpass123" }
```

### POST /auth/refresh

```json
// → 200 (returns a new AuthResponse with rotated refreshToken)
{ "refreshToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..." }
```

---

## Users

### GET /users/me

```json
// → 200
{
  "email": "maria.mueller@example.de",
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 1234567",
  "adresse": { "strasse": "Musterstraße", "hausnr": "12a", "plz": "68161", "ort": "Mannheim", "land": "DE" },
  "user_state": "ACTIVE",
  "created_at": "2026-04-01T10:00:00+02:00"
}
```

### PATCH /users/me

```json
// → 200 (returns updated GetUserResponse). All fields optional.
{
  "vorname": "Maria",
  "telefon": "+49 151 9999999",
  "adresse": { "strasse": "Neue Straße", "hausnr": "15", "plz": "68161", "ort": "Mannheim", "land": "DE" }
}
```

### DELETE /users/me

```json
// → 204 (schedules deletion; suspended users get 403)
{ "confirmPassword": "min8charpass123" }
```

### GET /users/me/refund-data

```json
// → 200 (the field set the EU-form needs; includes IBAN/BIC)
{
  "vorname": "Maria",
  "nachname": "Müller",
  "email": "maria.mueller@example.de",
  "telefon": "+49 151 1234567",
  "adresse": { "strasse": "Musterstraße", "hausnr": "12a", "plz": "68161", "ort": "Mannheim", "land": "DE" },
  "iban": "DE89370400440532013000",
  "bic": "COBADEFFXXX"
}
```

### PATCH /users/me/bank

```json
// → 200 (returns updated RefundDataResponse)
{ "iban": "DE89370400440532013000", "bic": "COBADEFFXXX" }
```

---

## Tickets

### GET /users/me/tickets

```json
// → 200
{
  "items": [
    {
      "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
      "ticket_state": "PENDING_DB_PAYMENT",
      "abreisedatum": "2026-05-12",
      "abreisebahnhof": "Mannheim Hbf",
      "zielbahnhof": "Karlsruhe Hbf",
      "fahrkartenpreis": "29.90",
      "antragsart": "ENTSCHAEDIGUNG_60_119",
      "erwartete_erstattung": "7.48",
      "email_status": "DELIVERED",
      "submitted_at": "2026-06-11T19:00:00+02:00",
      "updated_at": "2026-06-11T19:00:00+02:00"
    }
  ]
}
```

### GET /users/me/tickets/{ticketId}

```json
// → 200
{
  "email": "maria.mueller@example.de",
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "ticket_state": "PENDING_DB_PAYMENT",
  "state_timeline": [
    { "state": "VALIDATING", "at": "2026-06-11T18:04:00+02:00" },
    { "state": "READY", "at": "2026-06-11T18:04:30+02:00" },
    { "state": "EMAIL_SENDING", "at": "2026-06-11T19:00:00+02:00" }
  ],
  "extraction_status": "DONE",
  "extraction_method": "BARCODE",
  "extraction_confidence": 1.0,
  "barcode_uid": "118XYZ123456",
  "fahrt_abreisedatum": "2026-05-12",
  "fahrt_abreisebahnhof": "Mannheim Hbf",
  "fahrt_zielbahnhof": "Karlsruhe Hbf",
  "fahrt_abfahrtszeit_plan": "14:22",
  "fahrt_ankunftszeit_plan": "14:56",
  "fahrt_zugnummer_plan": "IC 2345",
  "fahrt_fahrkartennummer": "AB12345678",
  "fahrt_fahrkartenpreis": "29.90",
  "tatsaechlich_ankunftszeit": "16:01",
  "antragsgrund": ["VERSPAETUNG"],
  "antragsart": "ENTSCHAEDIGUNG_60_119",
  "is_zeitkarte": false,
  "delayMinutes": 65,
  "erwartete_erstattung": "7.48",
  "service_fee_betrag": "0.75",
  "email_status": "DELIVERED",
  "submitted_at": "2026-06-11T19:00:00+02:00",
  "updated_at": "2026-06-11T19:00:00+02:00",
  "belege_count": 0
}
```

### DELETE /users/me/tickets/{ticketId}

```
// → 204  (no request body, no response body)
```

### POST /users/me/tickets/{ticketId}/upload

```json
// → 200  (presigned POST envelope — POST the bytes to uploadUrl as multipart/form-data)
{ "filename": "ticket.pdf", "mimeType": "application/pdf" }
```

```json
{
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "uploadUrl": "https://railback.s3.eu-north-1.amazonaws.com/",
  "s3_key": "raw/<email-hash>/01J9XABCDEFGHIJKLMNOPQRST.pdf",
  "expiresIn": 300,
  "fields": {
    "key": "raw/<email-hash>/01J9XABCDEFGHIJKLMNOPQRST.pdf",
    "Content-Type": "application/pdf",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": "AKIA.../20260611/eu-north-1/s3/aws4_request",
    "X-Amz-Date": "20260611T180400Z",
    "Policy": "eyJleHBpcmF0aW9uIjogIjIwMjYtMDYtMTFUMTk6MDQ6MDBaIiwgLi4ufQ==",
    "X-Amz-Signature": "abc123def456..."
  }
}
```

### POST /users/me/tickets/{ticketId}/upload-confirm

```json
// → 200  (creates the RAW#<ticketId> row; extraction kicks off async)
{ "s3_key": "raw/<email-hash>/01J9XABCDEFGHIJKLMNOPQRST.pdf", "filename": "ticket.pdf", "mimeType": "application/pdf" }
```

```json
{ "ticketId": "01J9XABCDEFGHIJKLMNOPQRST", "extraction_status": "PROCESSING" }
```

### POST /users/me/tickets/route-lookup

```json
// → 200  (stateless query against ingest-delays data)
{ "fromStation": "Mannheim Hbf", "toStation": "Karlsruhe Hbf", "date": "2026-05-12", "timeWindow": { "from": "14:00", "to": "16:00" } }
```

```json
{
  "candidates": [
    {
      "trainNr": "IC 2345",
      "zugkategorie": "IC",
      "abfahrt_plan": "14:22",
      "ankunft_plan": "14:56",
      "abfahrt_tatsaechlich": "15:27",
      "ankunft_tatsaechlich": "16:01",
      "delayMinutes": 65,
      "any_cancelled": false,
      "data_quality": "FULL"
    }
  ]
}
```

### POST /users/me/tickets/from-route

```json
// → 201  (creates a MANUAL_ROUTE ticket directly in READY; no upload/extractor)
{
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "trainNr": "IC 2345",
  "date": "2026-05-12",
  "fromStation": "Mannheim Hbf",
  "toStation": "Karlsruhe Hbf",
  "abfahrtszeit_plan": "14:22",
  "ankunftszeit_plan": "14:56",
  "fahrkartennummer": "AB12345678",
  "fahrkartenpreis": "29.90",
  "is_zeitkarte": false,
  "templateId": "01J9TABCDEFGHIJKLMNOPQRST"
}
```

```json
{ "ticketId": "01J9XABCDEFGHIJKLMNOPQRST", "ticket_state": "READY", "extraction_method": "MANUAL_ROUTE", "extraction_confidence": 0.0 }
```

### POST /users/me/tickets/{ticketId}/delays

```json
// → 200
{ "trainNr": "IC 2345", "date": "2026-05-12", "abreisebahnhof": "Mannheim Hbf", "zielbahnhof": "Karlsruhe Hbf" }
```

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
  "suggested_antragsart": "ENTSCHAEDIGUNG_60_119",
  "data_quality": "FULL"
}
```

### POST /users/me/tickets/{ticketId}/refund

```json
// → 200  (computes + locks erwartete_erstattung and service_fee_betrag; renders + emails the EU-form)
{
  "antragsgrund": ["VERSPAETUNG"],
  "antragsart": "ENTSCHAEDIGUNG_60_119",
  "is_zeitkarte": false,
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

```json
{
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "ticket_state": "EMAIL_SENDING",
  "submitted_at": "2026-06-11T19:00:00+02:00",
  "email_status": "SENT",
  "erwartete_erstattung": "7.48",
  "service_fee_betrag": "0.75"
}
```

### POST /users/me/tickets/{ticketId}/belege

```json
// → 200  (presigned POST envelope for a Beleg; same field shape as ticket upload)
{ "filename": "taxi-rechnung.pdf", "mimeType": "application/pdf", "typ": "TAXI" }
```

```json
{
  "belegId": "01J9YABCDEFGHIJKLMNOPQRST",
  "uploadUrl": "https://railback.s3.eu-north-1.amazonaws.com/",
  "s3_key": "belege/<email-hash>/01J9XABCDEFGHIJKLMNOPQRST/01J9YABCDEFGHIJKLMNOPQRST.pdf",
  "expiresIn": 300,
  "fields": { "key": "belege/...", "Content-Type": "application/pdf", "Policy": "...", "X-Amz-Signature": "..." }
}
```

### POST /users/me/tickets/{ticketId}/belege/{belegId}/confirm

```json
// → 200
{
  "s3_key": "belege/<email-hash>/01J9XABCDEFGHIJKLMNOPQRST/01J9YABCDEFGHIJKLMNOPQRST.pdf",
  "filename": "taxi-rechnung.pdf",
  "mimeType": "application/pdf",
  "typ": "TAXI",
  "size_bytes": 142000,
  "amount": "23.50"
}
```

```json
{ "belegId": "01J9YABCDEFGHIJKLMNOPQRST" }
```

### DELETE /users/me/tickets/{ticketId}/belege/{belegId}

```
// → 204  (no request body, no response body)
```

---

## Route templates

### GET /users/me/route-templates

```json
// → 200
{
  "templates": [
    {
      "templateId": "01J9TABCDEFGHIJKLMNOPQRST",
      "label": "Pendelfahrt MA→KA",
      "fromStation": "Mannheim Hbf",
      "fromEva": 8000244,
      "toStation": "Karlsruhe Hbf",
      "toEva": 8000191,
      "fahrkartennummer": "AB12345678",
      "fahrkartenpreis": "29.90",
      "zugkategorie_pref": "IC",
      "created_at": "2026-06-18T08:00:00+02:00",
      "updated_at": "2026-06-18T08:00:00+02:00"
    }
  ]
}
```

### POST /users/me/route-templates

```json
// → 201  (returns the full RouteTemplate)
{
  "templateId": "01J9TABCDEFGHIJKLMNOPQRST",
  "label": "Pendelfahrt MA→KA",
  "fromStation": "Mannheim Hbf",
  "toStation": "Karlsruhe Hbf",
  "fahrkartennummer": "AB12345678",
  "fahrkartenpreis": "29.90",
  "zugkategorie_pref": "IC"
}
```

### PATCH /users/me/route-templates/{templateId}

```json
// → 200  (returns updated RouteTemplate). All fields optional.
{ "label": "Updated Pendelfahrt", "fahrkartenpreis": "32.50" }
```

### DELETE /users/me/route-templates/{templateId}

```
// → 204  (no request body, no response body)
```

---

## Admin

### GET /admin/stats

```json
// → 200  (30 s in-process cache; poll no faster than 30 s)
{
  "users": { "total": 19234, "active": 18900, "suspended": 7, "deletion_scheduled": 12 },
  "tickets": {
    "total": 27310,
    "by_state": { "VALIDATING": 41, "READY": 0, "EMAIL_SENDING": 7, "PENDING_DB_PAYMENT": 188, "APPROVED": 1340, "REJECTED": 502, "COMPLETED": 25239, "EMAIL_FAILED": 11, "INVALID": 1240 },
    "pending": 188
  },
  "refunds": { "total_paid_out": "104253.40", "currency": "EUR", "this_month_paid_out": "8420.10" },
  "as_of": "2026-06-11T19:30:00+02:00"
}
```

### GET /admin/users

```
GET /admin/users?user_state=ACTIVE&email=maria&limit=50&cursor=eyJlb...
```

```json
// → 200
{
  "items": [
    {
      "email": "maria.mueller@example.de",
      "vorname": "Maria",
      "nachname": "Müller",
      "telefon": "+49 151 1234567",
      "adresse": { "strasse": "Musterstraße", "hausnr": "12a", "plz": "68161", "ort": "Mannheim", "land": "DE" },
      "user_state": "ACTIVE",
      "suspended_at": null,
      "suspended_reason": null,
      "created_at": "2026-04-01T10:00:00+02:00",
      "ticket_count": 3,
      "total_refunded": "59.80",
      "iban": "DE89370400440532013000",
      "bic": "COBADEFFXXX"
    }
  ],
  "nextCursor": "eyJlb..."
}
```

### GET /admin/users/{email}

```json
// → 200  (list-item fields + recent_tickets)
{
  "email": "maria.mueller@example.de",
  "vorname": "Maria",
  "nachname": "Müller",
  "user_state": "ACTIVE",
  "created_at": "2026-04-01T10:00:00+02:00",
  "ticket_count": 3,
  "total_refunded": "59.80",
  "iban": "DE89370400440532013000",
  "bic": "COBADEFFXXX",
  "recent_tickets": [
    { "ticketId": "01J9XABCDEFGHIJKLMNOPQRST", "ticket_state": "COMPLETED", "abreisedatum": "2026-05-12", "erwartete_erstattung": "29.90" }
  ]
}
```

### PATCH /admin/users/{email}

```json
// → 200  (ban a user; suspended_reason required when user_state=SUSPENDED)
{ "user_state": "SUSPENDED", "suspended_reason": "Mehrfache betrügerische Anträge" }
```

### GET /admin/tickets

```
GET /admin/tickets?state=PENDING_DB_PAYMENT&trainNr=IC%202345&date=2026-05-12&limit=50&cursor=...
```

```json
// → 200  (review queue = ?state=PENDING_DB_PAYMENT)
{
  "items": [
    {
      "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
      "email": "maria.mueller@example.de",
      "vorname": "Maria",
      "nachname": "Müller",
      "ticket_state": "PENDING_DB_PAYMENT",
      "antragsart": "ENTSCHAEDIGUNG_60_119",
      "antragsgrund": ["VERSPAETUNG"],
      "abreisedatum": "2026-05-12",
      "abreisebahnhof": "Mannheim Hbf",
      "zielbahnhof": "Karlsruhe Hbf",
      "zugnummer_plan": "IC 2345",
      "fahrkartenpreis": "29.90",
      "erwartete_erstattung": "7.48",
      "delayMinutes": 65,
      "submitted_at": "2026-06-11T19:00:00+02:00",
      "updated_at": "2026-06-11T19:00:00+02:00"
    }
  ],
  "nextCursor": null
}
```

### GET /admin/tickets/{ticketId}

```json
// → 200  (IBAN/BIC visible to admin in plaintext; amounts are read-only)
{
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "email": "maria.mueller@example.de",
  "vorname": "Maria",
  "nachname": "Müller",
  "ticket_state": "PENDING_DB_PAYMENT",
  "state_timeline": [
    { "state": "VALIDATING", "at": "2026-06-11T18:04:00+02:00" },
    { "state": "READY", "at": "2026-06-11T18:04:30+02:00" }
  ],
  "extraction_method": "BARCODE",
  "extraction_confidence": 1.0,
  "barcode_uid": "118XYZ123456",
  "fahrt_abreisedatum": "2026-05-12",
  "fahrt_abreisebahnhof": "Mannheim Hbf",
  "fahrt_zielbahnhof": "Karlsruhe Hbf",
  "fahrt_zugnummer_plan": "IC 2345",
  "fahrt_fahrkartenpreis": "29.90",
  "antragsgrund": ["VERSPAETUNG"],
  "antragsart": "ENTSCHAEDIGUNG_60_119",
  "delayMinutes": 65,
  "erwartete_erstattung": "7.48",
  "service_fee_betrag": "0.75",
  "has_belege": false,
  "db_paid_at": null,
  "admin_note": null,
  "email_status": "DELIVERED",
  "sepa_mandate": { "state": "ISSUED", "expires_at": "2029-06-11T19:00:00+02:00" }
}
```

### PATCH /admin/tickets/{ticketId}

```json
// → 200  (payment-confirmation call; cannot edit erwartete_erstattung / service_fee_betrag / antragsart)
{ "ticket_state": "APPROVED", "db_paid_at": "2026-06-13T09:30:00+02:00", "admin_note": "Verspätung bestätigt anhand /fchg-Logs" }
```

### GET /admin/trains/{trainNr}/{date}/delays

```
GET /admin/trains/IC%202345/2026-05-12/delays
```

```json
// → 200  (same segment shape as the user delays endpoint)
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
  "suggested_antragsart": "ENTSCHAEDIGUNG_60_119",
  "data_quality": "FULL"
}
```

---

## Admin — SEPA

### GET /admin/sepa/pending-batches

```json
// → 200  (downloadUrl is a presigned GET for the pain.008 XML)
{
  "items": [
    {
      "batchId": "01JA2ABCDEFGHIJKLMNOPQRST",
      "s3_key": "pain008/2026-06/01JA2ABCDEFGHIJKLMNOPQRST.xml",
      "downloadUrl": "https://railback.s3.eu-north-1.amazonaws.com/pain008/2026-06/01JA2ABCDEFGHIJKLMNOPQRST.xml?X-Amz-Signature=...",
      "downloadUrlExpiresIn": 300,
      "mandate_count": 14,
      "total_eur": "10.50",
      "built_at": "2026-06-25T09:15:00+02:00"
    }
  ]
}
```

### POST /admin/sepa/batches/{batchId}/mark-submitted

```json
// → 200  (call after uploading the XML to the bank portal; empty request body)
{}
```

```json
{ "batchId": "01JA2ABCDEFGHIJKLMNOPQRST", "submitted_at": "2026-06-25T09:42:00+02:00", "mandates_marked": 14 }
```

### POST /admin/tickets/{ticketId}/pain008-rebuild

```json
// → 200  (rebuilds the pain.008 for a single ticket; empty request body)
{}
```

```json
{
  "ticketId": "01J9XABCDEFGHIJKLMNOPQRST",
  "mandate_id": "RB-01J9XABCDEFGHIJKLMNOPQRST",
  "pain008_batch_id": "01JA2ABCDEFGHIJKLMNOPQRST",
  "pain008_built_at": "2026-06-25T09:15:00+02:00",
  "pain008_s3_key": "pain008/2026-06/01JA2ABCDEFGHIJKLMNOPQRST.xml"
}
```

### POST /admin/sepa/reports/upload

```json
// → 200  (presigned POST for admin-uploaded pain.002 / camt.054; PutObject triggers sepa-reports)
{ "filename": "pain002-2026-06-25.xml", "content_type": "application/xml", "size_bytes": 4831 }
```

```json
{
  "url": "https://railback.s3.eu-north-1.amazonaws.com/",
  "fields": { "key": "sepa-reports/2026-06-25/01JA2ABCDEFGHIJKLMNOPQRST.xml", "Content-Type": "application/xml", "Policy": "...", "X-Amz-Signature": "..." },
  "expires_in": 300
}
```

---

## Errors

Every non-2xx returns the same `ErrorBody`:

```json
// e.g. 409 on duplicate barcode upload
{ "error": "ERR_CONFLICT", "message": "Du hast dieses Ticket schon hochgeladen", "details": { "existing_ticket_id": "01J9XABCDEFGHIJKLMNOPQRST" } }
```
