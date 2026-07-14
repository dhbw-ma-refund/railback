# RailBack — DynamoDB Schema (canonical)

> **Valid as of 2026-07-14.** This is the canonical schema doc as it stood on
> that date, vendored into this repo. Whether it is still current or has since
> been superseded is a judgment call for the reader — check the source/backend
> repo for anything newer before treating this as authoritative.

For Matrikel **8286131** (Database) and Matrikel **1334001** (Backend).
Single-table design. **Table name: `railback`.** Region: `eu-central-1`
(Frankfurt). All attribute names are case-sensitive and exactly as written.

This document is the single source of truth for the database layer — what
the backend reads/writes and what the DB person provisions. It supersedes
the slides in `Fachkonzept/railback_datenbank.pdf` where they conflict
(the conflicts are product decisions that landed after those slides:
EU-form switch, no email-verify, S3-backed blob storage, encrypted-attribute IBAN, sparse
GSIs for admin enumeration / barcode dedup / email retry queue, email as
canonical refund-delivery channel).

---

## Payment model (locked 2026-06-11, updated 2026-06-17)

**DB pays the user directly.** The EU-form Section 5.5 holds the **user's** IBAN/BIC,
not ours. We don't operate any payment service for the refund leg — no ZAG-Lizenz, no
RDG-Inkassoregistrierung, no PayPal Payouts, no escrow account, nothing.

What we do at "refund goes through" time: collect an **elektronisches SEPA-Mandat
(E-Mandat)** from the user (click-to-sign in the wizard, no paper, no PDF) and,
after admin-approval, run a **real pain.008 Lastschrift-Einzug** against our
Gläubiger-ID to pull the service fee from their IBAN. The mandate's audit trail
(consent timestamp / IP / user-agent) lives on the `SepaMandate` row; the pain.008
XML we submit to the bank is archived in S3 and referenced from the row.

Implications across the schema:
- `iban_enc` and `bic_enc` stay on UserProfile (encrypted at rest, see below).
- No `paypal_email`, no `payout_*` fields, no `PayPalWebhookEvent` entity.
- New entity `SepaMandate` tracks the E-Mandat + the pain.008 lifecycle.
- Mandate state machine: `ISSUED → DEBITED` (real pain.008 success) | `CANCELLED` (user revokes).
- Ticket lifecycle: `PENDING_DB_PAYMENT → APPROVED → COMPLETED`
  (see state machine table below). DB's payment to the user remains out-of-scope
  on our side (DB pays user directly, separate Sache) — admin can mark
  `db_paid_at` if confirmed.

## Email-as-canonical-channel (locked 2026-06-13, updated 2026-06-17)

The rendered EU-form is delivered to the user **by email only** (AWS SES, EU
region). No PDF download endpoint, no resend button, no admin PDF access. New
ticket states `EMAIL_SENDING` and `EMAIL_FAILED`; `PENDING_DB_PAYMENT` requires
confirmed delivery. Delivery confirmation lands via an **SNS-subscribed
`email-webhook` Lambda** (SES Configuration Set Event Destination → SNS topic →
Lambda) — no Svix, no Resend webhook. New sparse GSI `GSI_EMAIL_PENDING`
powers the retry sweeper. Full rationale in `DECISIONS.md`.

---

## Table provisioning (what the DB person creates)

- **One DynamoDB table**, name `RailBack`, region `eu-north-1`.
  (The table is already provisioned on AWS with this name/region; see
  `railback-db/node/scripts/create-ddb-table.mjs` for the authoritative
  `CreateTable` spec and `INTEGRATION_PLAN.md`.)
- **PK** (Partition Key, String) + **SK** (Sort Key, String).
- **⚠️ Physical attribute + index names are lowercase** (locked 2026-07-05):
  the real DDB attributes are `pk`, `sk`, `gsi1_pk`, `gsi1_sk`, `gsi2_pk`,
  `gsi2_sk`, `gsi_email_pending_pk`, `gsi_email_pending_sk`, `gsi3_pk`,
  `gsi3_sk`, and index names are `gsi1`, `gsi2`, `gsi_email_pending`, `gsi3`.
  The ERD and access-pattern tables below write them uppercase
  (`PK`/`SK`/`GSI*`) as **logical** names for readability — every writer
  (Node connector, Python `ticket-extractor`, `ingest-delays` export) MUST
  emit the **lowercase** physical names or the item lands under an attribute
  no index/query reads. See `DECISIONS.md` "Wire-format attribute names are
  lowercase".
- **Four GSIs** (logical `GSI*_PK`/`GSI*_SK`, physical `gsi*_pk`/`gsi*_sk`, all String attributes):
  - `GSI1` — admin enumeration of users/admins, train-by-trainNr+date for ticket lookup. Projection: `ALL`. Dense (every UserProfile / AdminProfile / UserTicket emits keys).
  - `GSI2` — barcode-UID duplicate detection. Projection: `KEYS_ONLY` (we only need `ticketId` back). **Sparse:** only User Ticket items with a successful Aztec decode populate `GSI2_PK`/`GSI2_SK`.
  - `GSI_EMAIL_PENDING` — sweeper retry queue for tickets whose last send attempt was **not** accepted by SES. Projection: `KEYS_ONLY`. **Sparse:** populated only when `email_status IN ("SENDING", "FAILED_TRANSIENT") AND email_attempts < 3 AND ticket_state = "EMAIL_SENDING"`. Tickets in `email_status = "SENT"` (SES accepted, awaiting Delivery event) are NOT in the queue — they're handled by the watchdog scan, not the retry sweeper. Application code clears the GSI keys on every transition (SES 2xx → SENT, attempt 3 → FAILED, Delivery event → DELIVERED).
  - `GSI3` — route-lookup by departure station + date for the route-template flow. Projection: `ALL` (lookup needs `delayMinutes`, `is_cancelled` etc. without a re-fetch). **Sparse:** only `TrainSegmentDelay` items populate `GSI3_PK = "STATION#<originEva>#<YYYY-MM-DD>"`, `GSI3_SK = "<plannedDeparture HH:MM>#<trainNr>"`. Used by `@railback/lib/refund/route-lookup.ts` from `user-handler` on `POST /users/me/tickets/route-lookup`.
- **DynamoDB Streams** are NOT used and should stay **disabled**. Trigger for `ticket-extractor` is **S3 `ObjectCreated` on the raw-uploads prefix** (locked 2026-06-17). No Lambda event-source mapping is wired to streams; leaving them disabled saves on shard-hour cost.
- **TTL** enabled on the attribute named `ttl` (Number, Unix epoch seconds). DDB only honors one TTL attribute; `archive_ttl` is read by an application-side scheduled job, not by DDB itself.
- **Billing**: pay-per-request (on-demand). No capacity to provision. Admin-tooling traffic is low; on-demand is the right default.
- **Encryption at rest**: AWS-managed key (`aws/dynamodb`) is fine. Defense-in-depth on top: IBAN/BIC are *additionally* encrypted at the application layer with AES-256-GCM before being written; the DB never sees plaintext.

What the DB person should **NOT** build:
- **S3 is not your scope.** Backend-team provisions the bucket, lifecycle rules and IAM. DDB rows for blob siblings (raw uploads, belege, rendered PDFs, pain.008 / SEPA-report XML) carry `s3_bucket` + `s3_key` *attributes* — those are plain strings the DB person stores like any other; the binary content lives in S3 and is fetched by the backend. **No chunking, no base64 in DDB.**
- No KMS-managed encryption for IBAN/BIC. The KEK is an env var on the Lambda; `iban_enc`/`bic_enc` attributes are what land in the table.
- No global tables / cross-region replication. Single region.
- No DAX / caching layer. On-demand DDB is fast enough.
- No DDB-backed refresh-token store. Refresh tokens are stateless (signed JWTs, rotated on each refresh); see `ARCHITECTURE.md` auth-handler. The trade-off (no per-token revocation) is documented and accepted for the MVP.

---

## Primary key + global secondary indexes — at a glance

- **PK / SK** — primary access pattern (per-user lookups, ticket-by-id, train segment delays, etc.)
- **GSI1** — admin enumeration of users/admins; train-by-trainNr+date for ticket lookup
- **GSI2** — barcode-UID duplicate detection (sparse: only on tickets with successful Aztec decode)
- **GSI_EMAIL_PENDING** — sweeper retry queue (sparse: only on tickets where the last send attempt was not SES-accepted, i.e. `email_status IN ("SENDING","FAILED_TRANSIENT") AND email_attempts < 3`)
- **GSI3** — route-lookup by departure station + date (sparse: only on `TrainSegmentDelay`)

All attributes documented below. Anything ending in `_enc` is AES-256-GCM ciphertext, stored as base64 of `iv (12B) || tag (16B) || ciphertext`. Master key (`RAILBACK_IBAN_KEK`) lives in Lambda env var.

---

## Mermaid ERD

```mermaid
erDiagram
    UserProfile ||--o{ UserTicket : "has"
    UserTicket  ||--|| TicketOwner : "1:1 ticketId→email mapping (for ticketId-only call sites)"
    UserTicket  ||--o{ OriginalReceipt : "owns 0..5"
    UserTicket  ||--|| RawUpload : "1:1 raw file"
    UserTicket  ||--o| RenderedPdf : "0..1 EU-form output"
    UserTicket  ||--o| SepaMandate : "0..1 service-fee mandate"
    UserTicket  }o--o{ TrainSegmentDelay : "matched via trainNr+date"

    UserProfile {
        string PK "USER#<email>"
        string SK "PROFILE"
        string GSI1_PK "USER"
        string GSI1_SK "EMAIL#<email>"
        string user_state "ACTIVE | SUSPENDED | DELETION_SCHEDULED"
        string hashed_password "bcrypt (salt embedded)"
        string vorname
        string nachname
        string telefon "Pflicht (EU-Form 5.3)"
        string adresse_strasse
        string adresse_hausnr
        string adresse_plz
        string adresse_ort
        string adresse_land "default DE, Pflicht (EU-Form 5.2)"
        string iban_enc "AES-256-GCM, user IBAN for DB to pay refund into AND for our SEPA mandate"
        string bic_enc "AES-256-GCM"
        string created_at "ISO-8601"
        string suspended_at "ISO-8601, set when user_state=SUSPENDED, cleared on unban"
        string suspended_reason "free text, Pflicht when transitioning to SUSPENDED"
        number ttl "set when DELETION_SCHEDULED, +30d (NEVER set while SUSPENDED — ban holds indefinitely)"
        bool   datenschutz_einwilligung "true at registration"
        bool   agb_akzeptiert "true at registration"
    }

    AdminProfile {
        string PK "ADMIN#<email>"
        string SK "PROFILE"
        string GSI1_PK "ADMIN"
        string GSI1_SK "EMAIL#<email>"
        string hashed_password
        string created_at
    }

    UserTicket {
        string PK "USER#<email>"
        string SK "TICKET#<ticketId>"
        string GSI1_PK "TRAIN#<trainNr>#<date>"
        string GSI1_SK "TICKET#<ticketId>"
        string GSI2_PK "BARCODE (constant, sparse)"
        string GSI2_SK "<barcode_uid>"
        string GSI_EMAIL_PENDING_PK "EMAIL_PENDING (constant, sparse)"
        string GSI_EMAIL_PENDING_SK "<email_last_attempt ISO>"
        string ticket_state "VALIDATING | READY | EMAIL_SENDING | PENDING_DB_PAYMENT | APPROVED | REJECTED | COMPLETED | EMAIL_FAILED | INVALID"
        string state_timeline "DDB list (L type) of {state, at} maps; append-only via list_append"
        string extraction_status "PROCESSING | DONE | FAILED"
        string extraction_method "BARCODE | PDF_TEXT | MANUAL | MANUAL_ROUTE"
        number extraction_confidence "1.0 / 0.95 / 0.0"
        string barcode_uid "UIC 918.3 ticket UID, used as GSI2_SK"
        string vorname_aus_ticket "snapshot from barcode/ocr — wizard prefill only, never compared to profile or rendered onto the EU-form"
        string nachname_aus_ticket "snapshot from barcode/ocr — wizard prefill only"
        string fahrt_abreisedatum "YYYY-MM-DD"
        string fahrt_abreisebahnhof
        string fahrt_zielbahnhof
        string fahrt_abfahrtszeit_plan "HH:MM"
        string fahrt_ankunftszeit_plan "HH:MM"
        string fahrt_zugnummer_plan
        string fahrt_zugkategorie_plan "ICE | IC | RE | ..."
        string fahrt_fahrkartennummer "EU-Form 3.2.7 Pflicht"
        string fahrt_fahrkartenpreis "decimal as string EUR"
        string tatsaechlich_ankunftsdatum "set at submit time"
        string tatsaechlich_abfahrtszeit
        string tatsaechlich_ankunftszeit
        string tatsaechlich_zugnummer
        string tatsaechlich_verpasster_anschluss_bahnhof "nullable"
        string antragsgrund "JSON list: VERSPAETUNG | AUSFALL | VERPASSTER_ANSCHLUSS"
        string antragsart "ERSTATTUNG_FAHRKARTE | ENTSCHAEDIGUNG_60_119 | ENTSCHAEDIGUNG_120_PLUS | ENTSCHAEDIGUNG_ZEITKARTE | KOSTEN_ALTERNATIVTRANSPORT"
        bool   is_zeitkarte "true if the ticket is a zeitkarte (frontend-set on /from-route or /upload). Drives compute-fee.ts ENTSCHAEDIGUNG_ZEITKARTE branch."
        string antragstellung_ort
        string antragstellung_datum
        bool   datenschutz_einwilligung
        bool   wahrheitserklaerung
        string zusaetzliche_angaben "optional, max 2500 chars"
        number delayMinutes "max delay across segments, cached at submit"
        string erwartete_erstattung "decimal EUR — single canonical refund amount, computed at submit time, IMMUTABLE thereafter (drives both EU-form 5 and SEPA-mandate fee math)"
        string service_fee_betrag "decimal EUR, our fee, computed at submit time, IMMUTABLE. Locked 2026-06-24: 0.75 EUR pauschal pro Antrag (see CLAUDE.md / DECISIONS.md)"
        string db_paid_at "ISO-8601, set by admin when DB confirmed payment to user"
        string admin_note "free text, optional, set on admin PATCH"
        string service_fee_state "PENDING | DEBITED | REVERSED | WAIVED — orthogonal to ticket_state; tracks the SEPA-pull lifecycle independently. Defaults to PENDING at submit. WAIVED if mandate cancelled before debit; REVERSED on R-transaction."
        string email_status "SENDING | SENT | FAILED_TRANSIENT | DELIVERED | BOUNCED | FAILED"
        number email_attempts "0..3 — incremented per send attempt"
        string email_last_attempt "ISO-8601 of most recent send attempt"
        string email_provider_id "SES MessageId, for support correlation"
        string email_failed_reason "max_retries | bounced | complained | webhook_timeout | render_missing (only when EMAIL_FAILED)"
        string uploaded_at
        string submitted_at
        string updated_at
        number ttl "state-dependent: 90d for INVALID/REJECTED/EMAIL_FAILED, null for COMPLETED"
        number archive_ttl "10y for buchungsrelevante (COMPLETED/APPROVED), application-side"
    }

    RawUpload {
        string PK "USER#<email>"
        string SK "RAW#<ticketId>"
        string filename
        string s3_bucket "binary content in S3, this row is metadata only"
        string s3_key "raw/<email-hash>/<ticketId>.<ext>"
        string content_type "application/pdf | image/jpeg | image/png"
        number size_bytes "S3-reported"
        string uploaded_at
        number ttl "+30d after extraction DONE; +7d on FAILED keep for debug"
    }

    RenderedPdf {
        string PK "USER#<email>"
        string SK "RENDERED#<ticketId>"
        string s3_bucket
        string s3_key
        number size_bytes
        string rendered_at
        number ttl "+6mo (sweeper-source archive)"
    }

    OriginalReceipt {
        string PK "USER#<email>"
        string SK "TICKET#<ticketId>#BELEG#<belegId>"
        string filename
        string s3_bucket
        string s3_key
        string content_type "application/pdf | image/jpeg | image/png"
        number size_bytes "max 5MB"
        string typ "TAXI | BUS | HOTEL | SONSTIGES"
        string uploaded_at
        number ttl "+6mo after ticket COMPLETED"
    }

    SepaMandate {
        string PK "USER#<email>"
        string SK "TICKET#<ticketId>#MANDATE"
        string mandate_id "ULID, also = mandate reference shown to user"
        string mandate_state "ISSUED | SUBMITTED | DEBITED | REVERSED | DISPUTED | EXPIRED | CANCELLED"
        string sequence_type "OOFF (one-off, locked v1) — every mandate is single-use"
        string fee_amount "decimal EUR, mirrors UserTicket.service_fee_betrag at issue time"
        string iban_enc "AES-256-GCM, snapshot of user IBAN at mandate issue"
        string bic_enc "AES-256-GCM, snapshot of user BIC at mandate issue"
        string kontoinhaber_snapshot "vorname + nachname at issue time"
        string user_consent_at "ISO-8601, when user clicked-to-sign in the wizard"
        string user_consent_ip "remote address at consent time, E-Mandat audit trail"
        string user_consent_user_agent "UA string at consent time, E-Mandat audit trail"
        string vorabankuendigung_sent_at "ISO-8601, when SES Vorabankündigung was sent (at mandate-issue, NOT at pain.008-build)"
        string pain008_built_at "nullable, ISO-8601 when XML was generated"
        string pain008_s3_key "nullable, S3 key of generated XML batch (pain008/<YYYY-MM>/<batchId>.xml)"
        string pain008_batch_id "nullable, ULID grouping multiple mandates into one bank-upload batch"
        string pain008_submitted_at "nullable, ISO-8601 when admin marked the batch as bank-uploaded"
        string debited_at "nullable, ISO-8601 when camt.054 confirmed booking"
        string reversed_at "nullable, ISO-8601 when camt.054 reported R-transaction"
        string reversed_reason "nullable, ISO20022 R-tx reason code (e.g. AC04 closed-account, MS03 not-specified)"
        string dispute_opened_at "nullable, ISO-8601 if user opened a 8-week refund window via debtor bank"
        string expires_at "ISO-8601, mandate_issued_at + 36 months — drives auto-EXPIRED transition for ISSUED mandates never debited"
        string issued_at "ISO-8601"
        number ttl "10y archive (financial document)"
    }

    SepaReport {
        string PK "SEPA#REPORT#<YYYY-MM-DD>"
        string SK "REPORT#<reportId>"
        string report_type "PAIN002 | CAMT054 | CAMT053"
        string s3_bucket "single bucket"
        string s3_key "sepa-reports/<YYYY-MM-DD>/<reportId>.xml"
        string sender "rueckmeldung@<bank>.example (typically the bank's own domain) — admin-supplied note"
        string ingest_source "MANUAL_UPLOAD (only path post-2026-06-20)"
        string mandates_correlated "JSON list of mandate_ids touched by this report"
        string parsed_at "ISO-8601"
        string received_at "ISO-8601"
        number ttl "10y archive (financial document)"
    }

    %% InboundMailMessage entity removed 2026-06-20 — inbound mail
    %% dropped from scope. MX-record points at a normal mail provider;
    %% admin reads DB replies in their regular mailclient. No backend
    %% storage of inbound emails. See DECISIONS.md "Inbound mail
    %% dropped" (2026-06-20).

    TrainSegmentDelay {
        string PK "TRAIN#<trainNr>#<date>"
        string SK "SEG#<segId>"
        string GSI3_PK "STATION#<originEva>#<YYYY-MM-DD> (sparse, only TrainSegmentDelay)"
        string GSI3_SK "<plannedDeparture HH:MM>#<trainNr>"
        number delayMinutes "max(arrival_delay, departure_delay) for this segment"
        string reason "numeric DB /fchg code as string, mapped to text at PDF render time"
        string origin "station name"
        string destination "station name"
        number origin_eva "EVA number, also encoded into GSI3_PK"
        number destination_eva "EVA number"
        string planned_departure "ISO-8601 local time HH:MM (from plan)"
        string actual_departure "ISO-8601 local time HH:MM (nullable until /fchg observation)"
        string planned_arrival "ISO-8601 local time HH:MM"
        string actual_arrival "ISO-8601 local time HH:MM (nullable)"
        string finalized_at "ISO-8601 UTC; set by ingest-delays sweep_finalize once planned_arrival + grace passed — read by route-lookup as the data-quality marker"
        bool   is_cancelled
        string source "iris | piebro"
        string last_seen_at
    }

    RouteTemplate {
        string PK "USER#<email>"
        string SK "TEMPLATE#<templateId>"
        string templateId "ULID"
        string label "free text, e.g. 'Pendelfahrt MA→KA'"
        string from_station "resolved name (top-200 list)"
        number from_eva "EVA number"
        string to_station
        number to_eva
        string fahrkartennummer "optional, can be empty for variable tickets"
        string fahrkartenpreis "optional, decimal as string"
        string zugkategorie_pref "optional, IC | RE | ICE | … filters lookup candidates"
        string created_at "ISO-8601"
        string updated_at "ISO-8601"
    }

    TicketOwner {
        string PK "TICKET#<ticketId>"
        string SK "OWNER"
        string email "owner of the ticket — resolves ticketId-only call sites to USER#<email>"
        string ticketId "ULID, mirrors PK suffix"
        string created_at "ISO-8601"
        number ttl "matches the ticket's TTL (90d for INVALID/REJECTED/EMAIL_FAILED, null for COMPLETED/APPROVED — anonymisation sweeper deletes the row when the ticket is anonymised)"
    }
```

---

## User state machine (locked)

```
                ┌──────────────────────────────────┐
                │                                  │
                ▼                                  │
   (registration) ──→ ACTIVE ◄──────── SUSPENDED   │
                        │                  │       │
                        │ user DELETE      │ admin │
                        │ /users/me        │ PATCH │
                        ▼                  ▼       │
                  DELETION_SCHEDULED ◄─────────────┘
                        │ (TTL +30d, then DDB drops profile,
                        │  sweeper anonymises tickets)
                        ▼
                    [deleted]
```

| State | Meaning | Triggered by |
|---|---|---|
| `ACTIVE` | Normal operating state. User can log in, submit refunds. | Registration; admin `PATCH` from `SUSPENDED` (unban) or `DELETION_SCHEDULED` (rescue). |
| `SUSPENDED` | Banned by admin. Login + refresh rejected with `ERR_FORBIDDEN`. Existing refund applications continue to be processed (the user is owed any in-flight email + admin decision); new applications cannot be submitted. Holds **indefinitely** — no TTL. | Admin `PATCH /admin/users/{email}` setting `user_state=SUSPENDED` and `suspended_reason`. |
| `DELETION_SCHEDULED` | GDPR scheduled erasure. Profile TTL'd to +30d; tickets anonymised but kept for buchungsrelevante retention. | User `DELETE /users/me` (from `ACTIVE` only); admin `PATCH` from any state. |

**Allowed transitions** (admin-driven via `PATCH /admin/users/{email}` unless noted):

| # | From → To | Trigger | Notes |
|---|---|---|---|
| U1 | (none) → `ACTIVE` | `POST /auth/register` | `PutItem` with condition `attribute_not_exists(PK)` |
| U2 | `ACTIVE → DELETION_SCHEDULED` | user `DELETE /users/me` OR admin PATCH | sets `ttl = now + 30d` |
| U3 | `ACTIVE → SUSPENDED` | admin PATCH | requires `suspended_reason`; sets `suspended_at = now`; **does not set `ttl`** (a ban does not auto-expire) |
| U4 | `SUSPENDED → ACTIVE` | admin PATCH (unban) | clears `suspended_at` and `suspended_reason` |
| U5 | `SUSPENDED → DELETION_SCHEDULED` | admin PATCH (escalate to erasure, e.g. on user request or terminal account closure) | sets `ttl = now + 30d`; clears `suspended_at`/`suspended_reason` (the row will be deleted anyway) |
| U6 | `DELETION_SCHEDULED → ACTIVE` | admin PATCH (rescue before TTL fires) | clears `ttl` |

**Forbidden / not modelled:**
- `SUSPENDED` users **cannot** self-delete via `DELETE /users/me` — endpoint returns `ERR_FORBIDDEN`. A banned user shouldn't be able to dodge the ban (and the audit trail) by triggering their own erasure; admin must explicitly escalate to `DELETION_SCHEDULED` if the user requests GDPR erasure.
- `DELETION_SCHEDULED → SUSPENDED` is not allowed. Banning an already-deleting user makes no sense; the row is on its way out.
- Users cannot be hard-deleted by admin in the MVP — escalate to `DELETION_SCHEDULED` and let the TTL run.

**Auth-handler enforcement:**
- `POST /auth/login` reads the profile, rejects `SUSPENDED` with `ERR_FORBIDDEN` and a message including `suspended_reason`.
- `POST /auth/refresh` does the same — JWTs minted before the suspension stop refreshing, so any active session terminates within one access-token TTL (~15 min).
- `POST /auth/login` also rejects `DELETION_SCHEDULED` (the account is on its way out; let them go).
- Existing access tokens in flight are accepted until they expire — we don't read the profile on every authorised request (would double DDB reads). The 15-minute window of post-ban API access is acceptable for the MVP; document it.

---

## Ticket state machine (locked)

```
VALIDATING ──→ READY ──→ EMAIL_SENDING ──→ PENDING_DB_PAYMENT ──→ APPROVED ──→ COMPLETED
     │           │            │                    │                  │
     │           │            ↓                    ↓                  ↓
     │           │        EMAIL_FAILED          REJECTED           REJECTED
     │           │         (terminal)         (terminal)          (admin reverse)
     ↓           ↓
   INVALID    INVALID
 (extraction (user soft-
  failed)     delete)
```

| State | Meaning | Triggered by |
|---|---|---|
| `VALIDATING` | Upload accepted, ticket-extractor running | `POST /upload` |
| `READY` | Extraction finished, wizard can prefill | extractor success — OR `POST /tickets/from-route` (MANUAL_ROUTE flow skips VALIDATING entirely) |
| `EMAIL_SENDING` | Refund PDFs rendered, email send in flight or awaiting webhook | `POST /refund` |
| `PENDING_DB_PAYMENT` | Email confirmed delivered to user; ticket is in admin review queue | SES `Delivery` event (via SNS → email-webhook) |
| `APPROVED` | DB paid user (admin saw confirmation); `db_paid_at` set | admin `PATCH` |
| `COMPLETED` | Post-payment cleanup done; mandate optionally executed | admin `PATCH` |
| `REJECTED` | DB rejected | admin `PATCH` |
| `EMAIL_FAILED` | Email delivery failed terminally (max retries, bounce, complaint, or 24h webhook timeout) | `email-sweeper` cron OR SES `Bounce`/`Complaint` event |
| `INVALID` | User soft-deleted OR extraction failed | `DELETE /tickets/{id}` OR extractor failure |

Notes:
- There is no `DB_APPROVED`, `DB_PAID`, `USER_PAYOUT_INITIATED`, or `SUBMITTED` state. `SUBMITTED` was replaced by `PENDING_DB_PAYMENT` (2026-06-13) — they describe the same moment, and the new name reflects what we're actually waiting on.
- `PENDING_DB_PAYMENT` is gated on confirmed email delivery: ticket transitions out of `EMAIL_SENDING` only when the SES `Delivery` event arrives via the SNS-subscribed `email-webhook` Lambda.
- `EMAIL_FAILED` is **terminal** — no recovery path within a ticket. The user must start a new application. Admin cannot transition out of it via PATCH (handler enforces this).
- Earlier drafts had `DB_APPROVED` etc. when we were brokering the money; under the locked SEPA-mandate-only model, money moves outside our system.

### Allowed transitions

All state transitions are `UpdateItem` with `ConditionExpression` checking the prior state and `list_append` on `state_timeline`. When a transition affects `GSI_EMAIL_PENDING` membership (entering or leaving `EMAIL_SENDING`, or hitting `email_attempts = 3`), the same update sets/clears `GSI_EMAIL_PENDING_PK`/`GSI_EMAIL_PENDING_SK` so the sparse index stays accurate.

| # | From → To | Trigger | Notes |
|---|---|---|---|
| 0 | (none) → `READY` | `POST /users/me/tickets/from-route` (MANUAL_ROUTE flow) | direct creation in `READY` via `TransactWriteItems` writing both `UserTicket` and `TicketOwner` (PK=`TICKET#<id>`, SK=`OWNER`); sets `extraction_method = "MANUAL_ROUTE"`, `extraction_confidence = 0.0`, `extraction_status = "DONE"`; populates `fahrt_*` from the route-lookup candidate; no `barcode_uid`, no `RAW#` sibling, no extractor invocation |
| 1 | `VALIDATING → READY` | extractor success | sets `extraction_*` fields |
| 2 | `VALIDATING → INVALID` | extractor failure | terminal |
| 3 | `READY → EMAIL_SENDING` | `POST /refund` | sets `submitted_at`, `erwartete_erstattung`, `service_fee_betrag` (locked 2026-06-24: 0.75 EUR pauschal pro Antrag), locks values; renders the EU-form PDF to S3 (sibling row carries `s3_key`); writes the SepaMandate row with E-Mandat consent + sends Vorabankündigung; `service_fee_state = "PENDING"`. **Defensive zero-fee guard**: dead code on the happy path (fee is always 0.75), but if `service_fee_betrag == "0.00"` (e.g. future admin-side waiver) the SEPA-mandate path is skipped entirely and `service_fee_state = "WAIVED"`. Inline SES `SendEmailCommand`. On 2xx: `email_status=SENT`, GSI keys cleared (waiting on Delivery event, watchdog covers timeout). On non-2xx: `email_status=FAILED_TRANSIENT`, `email_attempts=1`, `GSI_EMAIL_PENDING` keys set (sweeper picks up). |
| 4 | `READY → INVALID` | user delete | terminal |
| 5 | `EMAIL_SENDING → PENDING_DB_PAYMENT` | SES `Delivery` event (via SNS → email-webhook) | sets `email_status=DELIVERED`; clears `GSI_EMAIL_PENDING` keys (defensive — typically already clear since SENT clears them) |
| 6 | `EMAIL_SENDING → EMAIL_FAILED` | sweeper hits attempt 3 OR webhook bounce/complaint OR 24h watchdog | sets `email_failed_reason`, `email_status=FAILED/BOUNCED`; clears `GSI_EMAIL_PENDING` keys; terminal. **Reason precedence** when more than one applies: `bounced > complained > webhook_timeout > max_retries` (most-specific wins; bounce is a definitive recipient-MX answer, complaint is distinct because it gates future-flow inclusion of that address, webhook_timeout means SES accepted but never confirmed, max_retries is the catch-all where SES itself never accepted). The watchdog (`email_status=SENT` for >24h) sets `email_status=FAILED, email_failed_reason="webhook_timeout"`; the sweeper retry path (`email_status=FAILED_TRANSIENT`, attempt 3 fails) sets `email_status=FAILED, email_failed_reason="max_retries"`. |
| 7 | `PENDING_DB_PAYMENT → APPROVED` | admin PATCH | sets `db_paid_at` (typically same PATCH) |
| 8 | `PENDING_DB_PAYMENT → REJECTED` | admin PATCH | terminal |
| 9 | `APPROVED → COMPLETED` | admin PATCH | sets `archive_ttl = now + 10y` |
| 10 | `APPROVED → REJECTED` | admin PATCH (rare reverse) | terminal |
| 11 | any non-terminal → `INVALID` | admin force-delete | rare |
| 12 | `EMAIL_SENDING → READY` | render/persist failure inside `refund-pdf` | rollback path. `renderAndSend` throws on deterministic render or S3-persist errors (invalid EU-form template, PDF-lib blowup, S3 500 that isn't SES-shaped) and rolls the ticket back to `READY` before re-throwing as 5xx to the user's wizard. Clears the submit-time fields (`submitted_at`, `email_status`, `email_attempts`, `email_last_attempt`, `email_provider_id`) so the wizard retry starts from a clean slate; form data on the ticket stays as prefill. Added 2026-07-01 per audit finding `render-fail-rollback-unplanned`. |

`erwartete_erstattung` and `service_fee_betrag` are computed at transition #3 and **never** rewritten. Admin cannot edit them via PATCH; the SEPA mandate is issued against `service_fee_betrag` and the EU-form Section 5 is rendered with the same values, so any later change would desynchronise PDFs from data. If the amount is genuinely wrong, the admin rejects the ticket and the user submits a new application.

Update template (one transition):
```
UpdateItem
  Key: PK = USER#<email>, SK = TICKET#<ticketId>
  ConditionExpression: ticket_state = :from
  UpdateExpression:
      SET ticket_state = :to,
          updated_at = :now,
          state_timeline = list_append(state_timeline, :entry)
  ExpressionAttributeValues:
      :from = "PENDING_DB_PAYMENT"
      :to   = "APPROVED"
      :now  = "2026-06-11T19:30:00+02:00"
      :entry = [{ state: "APPROVED", at: :now }]
```

---

## Access patterns (cheat sheet)

| Operation | Index | Key expression |
|---|---|---|
| **User Profile** | | |
| Get user profile | PK | `PK = USER#<email> AND SK = PROFILE` |
| Register user | PK (`PutItem`, condition `attribute_not_exists(PK)`) | lands in `ACTIVE` directly |
| Update profile / bank | PK (`UpdateItem`) | `SET` the changed attrs only |
| Get refund-data fields | PK (`GetItem` with ProjectionExpression) | vorname, nachname, telefon, adresse_*, iban_enc, bic_enc |
| Schedule deletion | PK (`UpdateItem`) | `SET user_state=:ds, ttl=:now+30d` |
| Suspend user (ban) | PK (`UpdateItem`) | `SET user_state=:susp, suspended_at=:now, suspended_reason=:r` (admin only) |
| Unban user | PK (`UpdateItem`) | `SET user_state=:active REMOVE suspended_at, suspended_reason` (admin only) |
| **Admin Profile** | | |
| Get admin profile (login) | PK | `PK = ADMIN#<email> AND SK = PROFILE` |
| **Tickets** | | |
| List user's tickets | PK | `PK = USER#<email> AND begins_with(SK, "TICKET#")` |
| Get one ticket | PK | `PK = USER#<email> AND SK = TICKET#<id>` |
| **Resolve ticketId → email** (admin-handler / email-webhook / ticket-extractor) | PK | `PK = TICKET#<ticketId> AND SK = OWNER` |
| Soft-delete ticket | PK (`UpdateItem`) | sets `ticket_state=INVALID, ttl=:now+90d` |
| Save extraction result | PK (`UpdateItem`) | written by `ticket-extractor` |
| Submit refund | PK (`UpdateItem`, conditional on `READY`) | sets all submission fields, transitions to `EMAIL_SENDING` |
| **Sibling blobs** | | |
| Get raw upload | PK | `PK = USER#<email> AND SK = RAW#<id>` |
| Get rendered PDF | PK | `PK = USER#<email> AND SK = RENDERED#<id>` |
| List receipts for ticket | PK | `PK = USER#<email> AND begins_with(SK, "TICKET#<id>#BELEG#")` |
| Get SEPA mandate for ticket | PK | `PK = USER#<email> AND SK = TICKET#<id>#MANDATE` |
| List ISSUED mandates needing batching | (Scan) | `FilterExpression: mandate_state = "ISSUED" AND attribute_exists(pk_owner_ticket_in_APPROVED)` — pain008-generator runs after admin PATCH to APPROVED, single mandate per call (sync invoke), so no list-query needed at runtime; sweeper-side this is a daily Scan for stuck mandates |
| List pending batches awaiting admin upload | (Scan) | `FilterExpression: mandate_state = "ISSUED" AND attribute_exists(pain008_built_at) AND attribute_not_exists(pain008_submitted_at)` — admin's `GET /admin/sepa/pending-batches`. The mandate stays `ISSUED` until the admin marks the batch submitted; `pain008_built_at` is the marker that the XML has been generated and is ready for upload. |
| List mandates by expiry | (Scan) | `FilterExpression: mandate_state = "ISSUED" AND expires_at < now` — daily expiry sweeper |
| **Inbound SEPA reports** | | |
| List reports for a date | PK | `PK = SEPA#REPORT#<YYYY-MM-DD>` |
| Find mandate transitions by report | (lookup via `mandates_correlated` then PK Get on each mandate) | parser-driven, not query-driven |
| **Admin enumeration (GSI1)** | | |
| List all users | GSI1 | `GSI1_PK = USER AND begins_with(GSI1_SK, "EMAIL#")` |
| Search users by email prefix | GSI1 | `GSI1_PK = USER AND begins_with(GSI1_SK, "EMAIL#<prefix>")` |
| List all admins | GSI1 | `GSI1_PK = ADMIN AND begins_with(GSI1_SK, "EMAIL#")` |
| List tickets for a train+date | GSI1 | `GSI1_PK = TRAIN#<nr>#<date>` |
| **Sparse GSIs** | | |
| Duplicate ticket check | GSI2 | `GSI2_PK = BARCODE AND GSI2_SK = <uid>` |
| Email-sweeper retry queue | GSI_EMAIL_PENDING | `GSI_EMAIL_PENDING_PK = EMAIL_PENDING ORDER BY GSI_EMAIL_PENDING_SK ASC` (oldest first; only tickets whose last send was not SES-accepted) |
| Email-sweeper watchdog scan | (Scan) | `FilterExpression: ticket_state = "EMAIL_SENDING" AND email_status = "SENT" AND email_last_attempt < (now - 24h)` — runs in same cron pass, no GSI |
| **Train delays** | | |
| Delay lookup for a trip | PK | `PK = TRAIN#<nr>#<date> AND begins_with(SK, "SEG#")` |
| Route lookup (departures from station in window) | GSI3 | `GSI3_PK = STATION#<eva>#<date> AND GSI3_SK BETWEEN <fromTime> AND <toTime>` |
| **Route templates** | | |
| List user's templates | PK | `PK = USER#<email> AND begins_with(SK, "TEMPLATE#")` |
| Get one template | PK | `PK = USER#<email> AND SK = TEMPLATE#<id>` |
| **Maintenance** | | |
| Delete-cascade on user | PK | scan `PK = USER#<email>`, anonymise tickets |

Admin-tickets-by-state and admin-tickets-by-arbitrary-email are **not** indexed. Admin frontend uses Scan + filter for those — admin volume is low; acceptable.

**Sibling-blob access patterns return DDB metadata only.** `Get raw upload`, `Get rendered PDF`, and `List receipts for ticket` all surface `s3_bucket` + `s3_key`; the backend follows up with an S3 `GetObject` to fetch the binary content. DDB never stores blob bytes anymore.

---

## Item shapes (logical view)

DDB stores native types (`S`, `N`, `BOOL`, `M`, `L`); the JSON below is the logical shape.

### User Profile

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "PROFILE",
  "GSI1_PK": "USER",
  "GSI1_SK": "EMAIL#maria.mueller@example.de",

  "email": "maria.mueller@example.de",
  "vorname": "Maria",
  "nachname": "Müller",
  "telefon": "+49 151 1234567",
  "adresse_strasse": "Musterstraße",
  "adresse_hausnr":  "12a",
  "adresse_plz":     "68161",
  "adresse_ort":     "Mannheim",
  "adresse_land":    "DE",

  "hashed_password": "$2b$12$…",          // bcrypt; salt embedded in the hash
  "user_state": "ACTIVE",                 // ACTIVE | SUSPENDED | DELETION_SCHEDULED
  "created_at": "2026-04-01T10:00:00+02:00",
  "datenschutz_einwilligung": true,       // Pflicht at registration
  "agb_akzeptiert": true,                 // Pflicht at registration

  // Suspension — only present when user_state = SUSPENDED
  "suspended_at":     null,               // ISO-8601 when set
  "suspended_reason": null,               // free text, set by admin

  // Bank — application-layer-encrypted (AES-256-GCM)
  // Each *_enc attribute is base64 of: iv (12B) || tag (16B) || ciphertext
  "iban_enc": "<base64>",
  "bic_enc":  "<base64>",

  "ttl": 1735689600                       // only set when user_state=DELETION_SCHEDULED, +30d. NEVER set while SUSPENDED.
}
```

`email` is lowercased before being put into any key. Backend normalises; DB layer can assume already-normalised.

### Admin Profile

```jsonc
{
  "PK": "ADMIN#admin@railback.example",
  "SK": "PROFILE",
  "GSI1_PK": "ADMIN",
  "GSI1_SK": "EMAIL#admin@railback.example",

  "email": "admin@railback.example",
  "hashed_password": "$2b$12$…",
  "created_at": "2026-04-01T10:00:00+02:00"
}
```

Admins are seeded out-of-band (no registration endpoint). GSI1 is populated for symmetry with UserProfile and to support a future admin-enumeration pattern.

### User Ticket

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "TICKET#01J9X…",

  // GSI1 — train-by-trainNr+date for admin "tickets on this train" queries
  "GSI1_PK": "TRAIN#IC 2345#2026-05-12",
  "GSI1_SK": "TICKET#01J9X…",

  // GSI2 — sparse, only when extraction yielded a barcode UID
  "GSI2_PK": "BARCODE",
  "GSI2_SK": "118XYZ…",

  // GSI_EMAIL_PENDING — sparse, only while in EMAIL_SENDING with attempts < 3
  "GSI_EMAIL_PENDING_PK": "EMAIL_PENDING",
  "GSI_EMAIL_PENDING_SK": "2026-06-11T19:00:01+02:00",

  "ticketId": "01J9X…",
  "ticket_state": "PENDING_DB_PAYMENT",
  "state_timeline": [
    { "state": "VALIDATING",          "at": "2026-06-11T18:04:00+02:00" },
    { "state": "READY",               "at": "2026-06-11T18:04:30+02:00" },
    { "state": "EMAIL_SENDING",       "at": "2026-06-11T19:00:00+02:00" },
    { "state": "PENDING_DB_PAYMENT",  "at": "2026-06-11T19:00:42+02:00" }
  ],

  // Extraction (filled by ticket-extractor Lambda, OR set inline by user-handler
  // for MANUAL_ROUTE tickets created via POST /tickets/from-route)
  "extraction_status": "DONE",              // PROCESSING | DONE | FAILED
  "extraction_method": "BARCODE",           // BARCODE | PDF_TEXT | MANUAL | MANUAL_ROUTE
  "extraction_confidence": 1.0,
  "barcode_uid": "118XYZ…",                 // optional, also indexed via GSI2 — null for MANUAL_ROUTE
  "vorname_aus_ticket": "Maria",
  "nachname_aus_ticket": "Müller",

  // Fahrt laut Fahrplan (EU-form Section 3.2)
  "fahrt_abreisedatum":            "2026-05-12",
  "fahrt_abreisebahnhof":          "Mannheim Hbf",
  "fahrt_zielbahnhof":             "Karlsruhe Hbf",
  "fahrt_abfahrtszeit_plan":       "14:22",
  "fahrt_ankunftszeit_plan":       "14:56",
  "fahrt_zugnummer_plan":          "IC 2345",
  "fahrt_zugkategorie_plan":       "IC",
  "fahrt_fahrkartennummer":        "AB12345678",
  "fahrt_fahrkartenpreis":         "29.90",

  // Tatsächliche Fahrt (EU-form Section 3.3)
  "tatsaechlich_ankunftsdatum":            "2026-05-12",
  "tatsaechlich_abfahrtszeit":             "15:27",
  "tatsaechlich_ankunftszeit":             "16:01",
  "tatsaechlich_zugnummer":                "IC 2345",
  "tatsaechlich_verpasster_anschluss_bahnhof": null,

  // Antrag (EU-form Section 1, 4, 6)
  "antragsgrund":             ["VERSPAETUNG"],
  "antragsart":               "ENTSCHAEDIGUNG_60_119",
  "is_zeitkarte":             false,            // true → compute-fee uses DB-AGB-pauschale formel
  "antragstellung_ort":       "Mannheim",
  "antragstellung_datum":     "2026-06-11",
  "zusaetzliche_angaben":     null,
  "datenschutz_einwilligung": true,
  "wahrheitserklaerung":      true,

  // Workflow metadata
  "delayMinutes":          65,
  "erwartete_erstattung":  "29.90",         // computed at submit, IMMUTABLE
  "service_fee_betrag":    "0.75",          // locked 2026-06-24: 0.75 EUR pauschal pro Antrag, IMMUTABLE
  "db_paid_at":            null,            // ISO-8601, set on admin PATCH to APPROVED
  "admin_note":            null,
  "service_fee_state":     "PENDING",        // PENDING | DEBITED | REVERSED | WAIVED — orthogonal to ticket_state
  "uploaded_at":           "2026-06-11T18:04:00+02:00",
  "submitted_at":          "2026-06-11T19:00:00+02:00",
  "updated_at":            "2026-06-11T19:00:42+02:00",

  // Email delivery
  "email_status":          "DELIVERED",     // SENDING | SENT | FAILED_TRANSIENT | DELIVERED | BOUNCED | FAILED
  "email_attempts":        1,
  "email_last_attempt":    "2026-06-11T19:00:01+02:00",
  "email_provider_id":     "email_8eXqA9p…",
  "email_failed_reason":   null,            // only set when EMAIL_FAILED

  // Lifecycle
  "ttl":         null,                      // see TTL table
  "archive_ttl": null                       // 10y, set when COMPLETED
}
```

**Belege** are **separate sibling items** (`SK = TICKET#<ticketId>#BELEG#<belegId>`), not a list attribute on the ticket. Same for the raw upload (`SK = RAW#<ticketId>`) and the rendered EU PDF (`SK = RENDERED#<ticketId>`) — DDB rows hold metadata + `s3_bucket` + `s3_key`, the bytes live in S3 (2026-06-17 update). The SEPA mandate is also its own sibling (`SK = TICKET#<ticketId>#MANDATE`) but has no blob — it's a pure-DDB E-Mandat row carrying clickwrap consent + IBAN/BIC snapshot + fee_amount + (post-pain.008) submission audit fields. Each row TTLs independently; S3 lifecycle rules mirror the DDB TTLs for the blob siblings.

### Raw Upload (sibling)

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "RAW#01J9X…",
  "filename":     "ticket.pdf",
  "s3_bucket":    "railback-storage",
  "s3_key":       "raw/<email-hash>/01J9X….pdf",
  "content_type": "application/pdf",
  "size_bytes":   187432,
  "uploaded_at":  "2026-06-11T18:04:00+02:00",
  "ttl": 1736208000                         // 30d after extraction DONE; 7d on FAILED
}
```

DDB row is metadata only; the binary content lives in S3 at `s3://<s3_bucket>/<s3_key>`. The `ticket-extractor` Lambda is triggered by the S3 ObjectCreated event on the raw-uploads prefix; it reads `s3_bucket` + `s3_key` from the event and pulls the bytes via S3 GetObject. (DDB Streams is no longer the trigger — superseded 2026-06-17.)

**Race semantics (locked 2026-06-18).** The S3 ObjectCreated event can fire **before** the frontend's `POST .../upload-confirm` round-trip lands this `RAW#` row — they run on independent paths (the S3 PUT/POST and the API call are not transactionally linked). The extractor must therefore **not** depend on the `RAW#` row to bootstrap. Concrete contract:

- The extractor reads `bucket` + `key` directly from the S3 event payload, fetches bytes via `S3 GetObject`, runs the extraction cascade.
- `ticketId` is parsed from the S3 key by convention: `raw/<email-hash>/<ticketId>.<ext>`. The owning `email` is looked up via `GetItem PK=TICKET#<ticketId>, SK=OWNER` (the `TicketOwner` mapping row written transactionally at `POST /upload` time — see "Ticket Owner" section). The email-hash in the S3 key is one-way and only used for IAM prefix-pinning; it is **not** the source of `email` in the extractor.
- The extractor writes results to the `UserTicket` row at `(USER#<email>, TICKET#<ticketId>)` — both that row and the `TicketOwner` row were created in the initial `POST /upload` `TransactWriteItems`, so they always exist before the S3 event can fire.
- The `RAW#<ticketId>` sibling is metadata-only (filename, mimeType, size, uploaded_at). Useful for admin-tooling lookups and the cleanup sweeper; **not on the extractor's critical path**. If `upload-confirm` is slow or fails after a successful S3 POST, the extractor still runs and the user still sees `extraction_status` flip — the missing `RAW#` row gets backfilled by the eventual `upload-confirm`, or stays missing and is sweeper-cleanable.
- Idempotent: re-invocation on the same `(bucket, key)` re-runs cleanly (same UID, same fields, same row update).

DDB item size limit (400 KB) no longer applies to the upload payload — only the metadata row is in DDB. Backend applies a 10 MB hard cap (5 MB soft) at the API layer / via the **presigned POST policy's `content-length-range` condition** (locked 2026-06-18 — POST not PUT, see `DECISIONS.md`) to keep extraction predictable; well under the S3 single-POST limit.

### Rendered PDF (sibling)

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "RENDERED#01J9X…",
  "s3_bucket":    "railback-storage",
  "s3_key":       "rendered/<email-hash>/01J9X….pdf",
  "size_bytes":   234500,
  "rendered_at":  "2026-06-11T19:00:00+02:00",
  "ttl":          1781913600                // 6 months
}
```

Internal artefact only. **No download endpoint exists** (email is the canonical delivery channel). The S3 object exists so the email-sweeper can re-attach the same bytes on retry without re-rendering, plus 6-month archive (S3 lifecycle rule).

### Original Receipt (sibling, 0..5 per ticket)

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "TICKET#01J9X…#BELEG#01J9Y…",
  "filename":     "taxi-rechnung.pdf",
  "s3_bucket":    "railback-storage",
  "s3_key":       "belege/<email-hash>/01J9X…/01J9Y….pdf",
  "content_type": "application/pdf",
  "size_bytes":   142000,                   // max 5MB
  "typ":          "TAXI",                   // TAXI | BUS | HOTEL | SONSTIGES
  "uploaded_at":  "2026-06-11T18:30:00+02:00",
  "ttl":          1781913600                // 6mo after ticket COMPLETED
}
```

Only relevant for `KOSTEN_ALTERNATIVTRANSPORT` antragsart. Cap: 5 per ticket, 5 MB per file (S3-side).

### SEPA Mandate (sibling)

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "TICKET#01J9X…#MANDATE",
  "mandate_id":     "01J9Z…",               // ULID, also = mandate reference shown to user
  "mandate_state":  "ISSUED",               // ISSUED | SUBMITTED | DEBITED | REVERSED | DISPUTED | EXPIRED | CANCELLED
  "sequence_type":  "OOFF",                 // locked v1 — every mandate is single-use one-off
  "fee_amount":     "0.75",                 // locked 2026-06-24: 0.75 EUR pauschal pro Antrag; mirrors UserTicket.service_fee_betrag at issue time
  "iban_enc":       "<base64>",             // snapshot at issue time — does NOT update if user changes their bank later
  "bic_enc":        "<base64>",
  "kontoinhaber_snapshot": "Maria Müller",

  // E-Mandat audit trail (click-to-sign, no PDF)
  "user_consent_at":         "2026-06-11T19:00:00+02:00",
  "user_consent_ip":         "203.0.113.42",
  "user_consent_user_agent": "Mozilla/5.0 …",

  // Vorabankündigung — sent at mandate-issue (POST /refund), NOT at pain.008-build.
  // SEPA-Rulebook requires ≥1 calendar-day-lead before debit; admin-approval typically
  // takes days, so the lead is always satisfied.
  "vorabankuendigung_sent_at": "2026-06-11T19:00:01+02:00",

  // pain.008 lifecycle — null until admin batches and submits
  "pain008_built_at":        null,          // when XML was generated by pain008-generator
  "pain008_batch_id":        null,          // ULID; multiple mandates may share one batch
  "pain008_s3_key":          null,          // S3 key of the batched XML (audit)
  "pain008_submitted_at":    null,          // when admin marked the batch as bank-uploaded

  // Settlement lifecycle — set by sepa-reports Lambda parsing inbound XML
  "debited_at":              null,          // camt.054 booking confirmation
  "reversed_at":              null,         // camt.054 R-transaction
  "reversed_reason":          null,         // ISO20022 reason code (AC04 / MS03 / …)
  "dispute_opened_at":        null,         // user opened 8-week debtor-bank refund window

  // Validity — drives auto-EXPIRED for ISSUED mandates never debited
  "expires_at":     "2029-06-11T19:00:00+02:00",   // issued_at + 36 months
  "issued_at":      "2026-06-11T19:00:00+02:00",
  "ttl":            2098598400              // 10y archive (financial document)
}
```

**No PDF rendered or stored** — the mandate is purely electronic (E-Mandat). The PDF-render branch has been deleted from the `refund-pdf` Lambda. Snapshot semantics on `iban_enc`/`bic_enc` mirror real-world SEPA mandates: each mandate references a specific bank account at issue time. If the user later updates their IBAN via `PATCH /users/me/bank`, the mandate keeps the IBAN it was issued against.

**State machine v2 (locked 2026-06-20):**

```
ISSUED ──► SUBMITTED ──► DEBITED ──► REVERSED ──► DISPUTED
   │           │            │
   │           │            └──► (terminal — fee collected)
   │           │
   │           └─► REVERSED   (rejection at submission, no booking happened)
   │
   ├─► CANCELLED   (user revokes pre-debit)
   │
   └─► EXPIRED     (ISSUED but never debited within 36 months — sweeper-driven)
```

| State | Meaning | Triggered by |
|---|---|---|
| `ISSUED` | E-Mandat created, click-consent recorded, Vorabankündigung sent. Awaiting admin-approval to enter the SEPA pull cycle. | `POST /refund` (creates the row) |
| `SUBMITTED` | pain.008 XML built and admin has marked the batch as physically uploaded to the bank's web-banking portal. Awaiting bank confirmation. | `POST /admin/sepa/batches/{id}/mark-submitted` (admin) |
| `DEBITED` | Bank confirmed booking via camt.054. Service fee collected. Terminal-success. | `sepa-reports` Lambda parsing camt.054 |
| `REVERSED` | R-transaction (RJCT/RTRN/RVSL) returned by the bank. Service fee NOT collected. | `sepa-reports` Lambda parsing pain.002 (rejection at submission) or camt.054 (return after booking) |
| `DISPUTED` | User opened the SEPA 8-week refund window via their debtor bank. Mandate technically debited but money returned. Effectively-failed for our books. | `sepa-reports` Lambda parsing camt.054 with REFD reason |
| `EXPIRED` | ISSUED for >36 months without ever progressing. Mandate-validity-fenster expired per SEPA rulebook. | daily expiry-sweeper pass in `anonymisation-sweeper` |
| `CANCELLED` | User explicitly revoked consent before debit (no UI for this in v1, but state exists for support cases). | manual admin override (out-of-scope v1) |

**Allowed transitions:**

| # | From → To | Trigger |
|---|---|---|
| M1 | (none) → `ISSUED` | `POST /refund` — writes row + sends Vorabankündigung |
| M2 | `ISSUED → SUBMITTED` | `POST /admin/sepa/batches/{id}/mark-submitted` after pain.008-XML upload to bank portal |
| M3 | `SUBMITTED → DEBITED` | `sepa-reports` parses camt.054 booking confirmation |
| M4 | `SUBMITTED → REVERSED` | `sepa-reports` parses pain.002 rejection |
| M5 | `DEBITED → REVERSED` | `sepa-reports` parses camt.054 R-transaction (return after booking) |
| M6 | `DEBITED → DISPUTED` | `sepa-reports` parses camt.054 REFD (debtor-initiated refund within 8 weeks) |
| M7 | `ISSUED → EXPIRED` | daily sweeper: `expires_at < now AND mandate_state = "ISSUED"` |
| M8 | `ISSUED → CANCELLED` | manual admin override (rare, not in v1 admin UI) |

`UserTicket.service_fee_state` mirrors mandate-state at higher granularity:
- `ISSUED|SUBMITTED` → `service_fee_state = "PENDING"`
- `DEBITED` → `service_fee_state = "DEBITED"`
- `REVERSED|DISPUTED` → `service_fee_state = "REVERSED"`
- `EXPIRED|CANCELLED` → `service_fee_state = "WAIVED"`

The `ticket_state` (refund lifecycle) is **independent** of `service_fee_state` (our-fee-collection lifecycle). A ticket can be `COMPLETED` (DB paid the user) while service-fee is `REVERSED` (we didn't collect our fee). That's a known business loss; out-of-scope to chase manually in v1.

### SEPA Report (inbound bank reports)

```jsonc
{
  "PK": "SEPA#REPORT#2026-06-25",
  "SK": "REPORT#01JA1…",
  "report_type":      "CAMT054",            // PAIN002 | CAMT054 | CAMT053
  "s3_bucket":        "railback-storage",
  "s3_key":           "sepa-reports/2026-06-25/01JA1….xml",
  "sender":           "rueckmeldung@<bank>.example",  // admin-supplied note, copied from the bank email's From header
  "ingest_source":    "MANUAL_UPLOAD",       // only path post-2026-06-20 (admin uploads via POST /admin/sepa/reports/upload)
  "mandates_correlated": ["01J9Z…", "01J9X…"],   // mandate_ids touched, set by parser
  "parsed_at":        "2026-06-25T08:00:00+02:00",
  "received_at":      "2026-06-25T07:55:00+02:00",
  "ttl":              2098598400            // 10y financial-doc retention
}
```

Inbound bank reports land here via **one path (locked 2026-06-20):**
admin downloads the report XML from the bank (typically as an email
attachment in the admin's regular mailbox, since the domain's MX-record
points at a normal mail provider rather than SES) and uploads it via
`POST /admin/sepa/reports/upload` (issues a presigned POST to
`sepa-reports/<YYYY-MM-DD>/<reportId>.xml`). The S3 PutObject triggers
the `sepa-reports` Lambda (S3 ObjectCreated on `sepa-reports/*`), which
parses the XML, correlates mandate_ids by `EndToEndId`, and updates
each `SepaMandate` row's state per the table above. **No SES Receipt
Rule** for `sepa-reports@<domain>` — that path was rejected
2026-06-20 (see DECISIONS.md "Inbound mail dropped"). PK partitions by
date for admin-tooling-scale scans; `mandates_correlated` is a list
because one camt.054 typically batches many R-tx confirmations.

### Inbound Mail Message

> **Removed 2026-06-20.** Inbound mail dropped from scope. The domain's
> MX-record points at a normal mail provider; admin reads DB replies
> in their regular mailclient. No backend storage, no entity. See
> DECISIONS.md "Inbound mail dropped" (2026-06-20).

### Train Segment Delay

```jsonc
{
  "PK": "TRAIN#IC 2345#2026-05-12",
  "SK": "SEG#8000244-8000191",

  // GSI3 — sparse, only TrainSegmentDelay populates these.
  // Indexes the segment's ORIGIN stop so route-lookup can find departures
  // from a station in a time window.
  "GSI3_PK": "STATION#8000244#2026-05-12",
  "GSI3_SK": "2026-05-12T14:22#IC 2345",          // <date>T<HH:MM>#<trainNr> — poller writes full ISO; adapter date-prefixes the route-lookup BETWEEN bounds to match

  "delayMinutes":      65,
  "reason":            "32",                     // numeric /fchg code as string; mapped to text at PDF render time
  "origin":            "Mannheim Hbf",
  "destination":       "Karlsruhe Hbf",
  "origin_eva":        8000244,
  "destination_eva":   8000191,
  "planned_departure": "2026-05-12T14:22",       // full ISO local, from /plan; adapter normalizes to "14:22" on read
  "actual_departure":  "2026-05-12T15:27",       // full ISO local, from /fchg (null until observed); normalized to "15:27" on read
  "planned_arrival":   "2026-05-12T14:56",       // normalized to "14:56" on read
  "actual_arrival":    "2026-05-12T16:01",       // (null until observed); normalized to "16:01" on read
  "finalized_at":      "2026-05-12T17:00:00Z",   // UTC; set by sweep_finalize when planned_arrival + grace passed
  "is_cancelled":      false,
  "source":            "iris",                   // iris | piebro
  "last_seen_at":      "2026-06-11T20:00:00+02:00"
}
```

Written by the `ingest-delays` poller's hourly export job. Backend only reads. No TTL — delay history is not personenbezogen and we keep it indefinitely. Reason codes stored verbatim (numeric); translation to German text happens in `refund-pdf` Lambda via bundled `reason-codes.json` (decouples ingestion from presentation).

**Export contract** (`ingest-delays/scripts/export_to_ddb.py` → DDB BatchWriteItem):

| DDB attribute | SQLite source column | Notes |
|---|---|---|
| `pk` | `'TRAIN#' \|\| train_nr \|\| '#' \|\| date` | derived in SQL (physical name is lowercase) |
| `sk` | `'SEG#' \|\| seg_id` | derived |
| `gsi3_pk` | `'STATION#' \|\| origin_eva \|\| '#' \|\| date` | derived |
| `gsi3_sk` | `planned_departure \|\| '#' \|\| train_nr` | derived — `<date>T<HH:MM>#<trainNr>` (full ISO planned_departure) |
| `delayMinutes` | `delay_minutes` | |
| `reason` | `reason` | nullable |
| `origin` | `origin` | station name |
| `destination` | `destination` | station name |
| `origin_eva` | `origin_eva` | |
| `destination_eva` | `destination_eva` | |
| `planned_departure` | `planned_departure` | full ISO `<date>T<HH:MM>`; adapter normalizes to `HH:MM` on read |
| `actual_departure` | `actual_departure` | nullable; full ISO, normalized to `HH:MM` on read |
| `planned_arrival` | `planned_arrival` | full ISO, normalized to `HH:MM` on read |
| `actual_arrival` | `actual_arrival` | nullable; full ISO, normalized to `HH:MM` on read |
| `finalized_at` | `finalized_at` | only finalized rows are exported (`WHERE finalized_at IS NOT NULL`) |
| `is_cancelled` | `is_cancelled` (0/1) | converted to BOOL |
| `source` | `source` | |
| `last_seen_at` | `last_seen_at` | |

`route-lookup` reads all of these (GSI3 projection is `ALL`) — the `data_quality` flag in the response (`FULL` / `PARTIAL` / `PLAN_ONLY`) is derived from whether `finalized_at` is set on the matched segments and whether both endstations were polled. SQLite needs an additional column `ddb_synced_at` so the exporter only ships rows that haven't been pushed (or have changed since last push); that column is poller-internal and is **not** exported.

GSI3 keys are written as part of the same export — the poller's `export_to_ddb.py` derives `gsi3_pk` / `gsi3_sk` (physical lowercase names) from `origin_eva`, `date`, and `planned_departure` columns. `GSI3` is sparse: only this entity populates it.

**Time format (locked 2026-07-11).** The poller stores the four time
attributes (`planned_departure`, `actual_departure`, `planned_arrival`,
`actual_arrival`) — and therefore the `gsi3_sk` prefix — as **full ISO
`<date>T<HH:MM>`**, not the bare `HH:MM` earlier drafts assumed. The exported
DDB data is the single source of truth and is **not** rewritten. Two
consequences, both handled in the `railback-db/node` adapter so every consumer
(route-lookup lib, `/delays`, `/admin/…/delays`, `refund-pdf`) keeps seeing
`HH:MM`:
1. **`routeLookup` date-prefixes its window bounds** — the caller passes
   `HH:MM`; the connector builds `<date>T<HH:MM>` bounds for the `gsi3_sk
   BETWEEN` so the query matches the stored ISO keys. `date` is already pinned
   by `gsi3_pk`, so this stays an exact index range (no scan).
2. **`mapSegmentDelay` strips the `<date>T` prefix on read** — the four time
   fields come back as `HH:MM`, matching the `SegmentDelay` DTO contract. Bare
   `HH:MM` (e.g. from the in-memory mock) passes through untouched, so both
   backends stay contract-equivalent.

### Route Template

```jsonc
{
  "PK": "USER#maria.mueller@example.de",
  "SK": "TEMPLATE#01J9T…",
  "templateId":         "01J9T…",            // ULID, frontend-generated
  "label":              "Pendelfahrt MA→KA",
  "from_station":       "Mannheim Hbf",
  "from_eva":           8000244,
  "to_station":         "Karlsruhe Hbf",
  "to_eva":             8000191,
  "fahrkartennummer":   "AB12345678",        // optional, may be empty / null
  "fahrkartenpreis":    "29.90",             // optional, decimal as string
  "zugkategorie_pref":  "IC",                // optional, filters candidate-list
  "created_at":         "2026-06-18T08:00:00+02:00",
  "updated_at":         "2026-06-18T08:00:00+02:00"
}
```

User-owned, no cap (list typically < 10 in practice; even pendlers don't have many distinct routes). No TTL — templates live with the account. The cascade-delete sweeper (`anonymisation-sweeper`) hard-deletes `TEMPLATE#…` siblings when the user is anonymised — no 10y archive grounds (the template is convenience metadata, not buchungsrelevant).

Templates are a pure prefill convenience: tickets created via `POST /tickets/from-route` carry the template's destination/origin on the ticket itself (`fahrt_*`), but **do NOT carry a `route_template_id` reference back**. If the template is later renamed or deleted, the old tickets are unaffected — they have their own snapshot of the fahrt data.

### Ticket Owner (ticketId → email mapping)

```jsonc
{
  "PK":         "TICKET#01J9X…",
  "SK":         "OWNER",
  "email":      "maria.mueller@example.de",
  "ticketId":   "01J9X…",
  "created_at": "2026-06-11T18:04:00+02:00",
  "ttl":        null
}
```

**Why this row exists.** Every UserTicket lives at `(USER#<email>, TICKET#<ticketId>)`, so any call site that has *both* identifiers can `GetItem` directly. Three call sites have only the `ticketId`:

- **`admin-handler`**: `GET/PATCH /admin/tickets/{ticketId}` — admin clicks a ticket in the queue, the request carries `ticketId` only.
- **`email-webhook`** (SES Delivery / Bounce / Complaint events via SNS): the SES Configuration-Set event echoes our custom `X-Ticket-Id: <ticketId>` header, but not the user's email.
- **`ticket-extractor`** (S3 ObjectCreated trigger): the S3 key is `raw/<email-hash>/<ticketId>.<ext>`. The hash is one-way (privacy-side, IAM prefix-pinning); it cannot be reversed to recover the email.

In all three cases the handler does `GetItem PK=TICKET#<ticketId>, SK=OWNER`, reads `email`, and proceeds with the canonical `(USER#<email>, TICKET#<ticketId>)` lookup.

**Why a mapping row, not a GSI.** A `GSI_TICKET_ID` would cost write-throughput on every `UserTicket` update (every state-machine transition). The mapping row is written **once** at ticket creation (`POST /upload` issues the presigned POST + creates `UserTicket` in `VALIDATING` + writes the `TicketOwner` row in the same `TransactWriteItems`) and never updated thereafter. `GetItem` on `(TICKET#<id>, OWNER)` is also cheaper than a GSI Query.

**Lifecycle.** The mapping row is created at the same moment as the `UserTicket` row (transactional `PutItem` pair) and deleted by the `anonymisation-sweeper` when the parent ticket is anonymised or hard-deleted. Its `ttl` mirrors the parent ticket's `ttl` for the terminal-with-cleanup states (`INVALID` / `REJECTED` / `EMAIL_FAILED` → +90d) so DDB drops it for free; for `COMPLETED` / `APPROVED` (10y archive) it stays alongside the anonymised ticket. Hard-deleted by the cascade sweeper when the parent is finally erased after the 10y window.

**No race in the create path.** `POST /upload` is the entry point that mints `ticketId`. The handler's `TransactWriteItems` writes both `UserTicket` (`VALIDATING`) and `TicketOwner` atomically before returning the presigned POST URL to the frontend. By the time S3 fires the `ObjectCreated` event (or any later admin / webhook call lands), the mapping row exists.

**MANUAL_ROUTE flow** (`POST /tickets/from-route`) writes both rows in the same transaction too — same pattern, just no presigned-POST issuance.

---

## IDs and key normalisation

- **`email`** is lowercased before being put into any key. Backend normalises; DB layer can assume already-normalised.
- **`ticketId`** is a ULID (26 chars, Crockford base32). Generated client-side by the frontend so the wizard is idempotent — re-posting the same upload with the same id replaces the raw payload safely.
- **`templateId`** is a ULID, generated client-side (mirrors `ticketId`). User-owned, scoped under `PK = USER#<email>`.
- **`belegId`** / **`mandate_id`** are ULIDs, generated server-side.
- **`segId`** is `<originEva>-<destinationEva>`, e.g. `8000244-8000191`. Comes from the `ingest-delays` poller; DB just stores it.
- **`barcode_uid`** is the UIC 918.3 ticket UID extracted from the Aztec barcode. Only present when extraction was barcode-based.

---

## Encryption layout

`*_enc` attributes are base64 of `iv || tag || ciphertext` where:
- `iv` = 12 random bytes per encryption (do NOT reuse)
- `tag` = 16 bytes from AES-GCM
- `ciphertext` = the plaintext encrypted with `RAILBACK_IBAN_KEK`

One env var holds the 32-byte master key (base64 in env, decoded once on Lambda init). Re-encrypt to rotate. KMS not used; keeps local-dev parity.

`admin-handler` ~~**must project these attributes away** on every read~~
**(reversed 2026-07-07 — see `DECISIONS.md`)**. As of 2026-07-07 admin
reads decrypt `iban_enc` / `bic_enc` and surface them as plaintext
`iban` / `bic` in response bodies. The `userRepo.getByEmailAdminView()`
method still exists as the admin-context signal but no longer strips
ciphertext. Encryption at rest stays as defense against DB dump /
provider exfil.

---

## TTL strategy

DDB only honours one TTL attribute per item (`ttl`). For "expire just one attribute, keep the rest of the item" we use an application-side sweeper Lambda; for "anonymise on cascade" we run another sweeper. DDB engineer: just enable TTL on `ttl`, the rest is application logic.

| Item | When set | Value | Mechanism |
|---|---|---|---|
| User Profile | on `ACTIVE → DELETION_SCHEDULED` | now + 30d | DDB TTL |
| User Profile | on `ACTIVE → SUSPENDED` | **none** — ban holds indefinitely | n/a |
| User Ticket — `INVALID` / `REJECTED` / `EMAIL_FAILED` | on transition | now + 90d | DDB TTL |
| User Ticket — `COMPLETED` / `APPROVED` | on transition | **don't set `ttl`**; set `archive_ttl = now + 10y` | application-side cleanup at archive_ttl (anonymise, don't delete) |
| User Ticket — abandoned in `VALIDATING` | when `now - uploaded_at > 30d` | uploaded_at + 30d | DDB TTL |
| Raw Upload | on insert | extraction `DONE` → +30d; `FAILED` → +7d | DDB TTL on row + matching S3 lifecycle rule |
| Rendered PDF | on insert | now + 6mo | DDB TTL on row + matching S3 lifecycle rule (6mo) |
| Original Receipt | when ticket → `COMPLETED` | now + 6mo | DDB TTL on row + matching S3 lifecycle rule (6mo) |
| SEPA Mandate | on insert | now + 10y (financial doc) | DDB TTL — no PDF, row stays 10y in DDB |
| SEPA Report | on insert | now + 10y (financial doc) | DDB TTL — XML + parsed-row both 10y |
| Inbound Mail Message | on insert | now + 90d | DDB TTL on row + matching S3 lifecycle rule (90d) |
| Train Segment Delay | n/a | indefinite (not personenbezogen) | — |

**Cascade on user delete: anonymise tickets, don't delete.** When the User Profile's `ttl` fires (DDB drops the profile), the user's tickets must be retained for 10y where buchungsrelevant. This is **not** automatic — DDB TTL deletes only the one item it's set on. Backend runs a daily sweeper:

1. Lists profiles with `user_state = DELETION_SCHEDULED` and `ttl < now` (or, equivalently, sweeps tickets whose owner's PROFILE is gone).
2. For each, queries `USER#<email>` + `begins_with(SK, "TICKET#")` and `begins_with(SK, "TICKET#…#MANDATE")`.
3. For each ticket: `UpdateItem` setting `vorname = null`, `nachname = null`, removing `iban_enc`/`bic_enc`/`telefon`/`adresse_*`, replacing `email` in the PK with a SHA-256 hash; keeping `ticketId`, `state_timeline`, `erwartete_erstattung`, `service_fee_betrag`, `db_paid_at`, `submitted_at`.
4. SepaMandate items are anonymised the same way (`iban_enc`/`bic_enc`/`kontoinhaber_snapshot`/`user_consent_ip`/`user_consent_user_agent` nulled), but the row itself is **never hard-deleted** — kept for the 10y financial-doc archive. Surviving fields: `mandate_id`, `mandate_state`, `sequence_type`, `fee_amount`, `user_consent_at` (date only, kept as bookkeeping evidence the mandate existed), `pain008_built_at`, `pain008_batch_id`, `pain008_s3_key`, `debited_at`, `reversed_at`, `reversed_reason`, `dispute_opened_at`, `expires_at`, `issued_at`.
5. **RouteTemplate items (`SK begins_with "TEMPLATE#"`) are hard-deleted.** Templates are pure convenience metadata, not buchungsrelevant — no archive obligation.
6. **TicketOwner mapping rows (`PK = TICKET#<ticketId>, SK = OWNER`) are hard-deleted** for tickets that are themselves anonymised. The mapping is only useful for live call sites (admin queue, SES webhook, extractor); after anonymisation no further calls can land on the ticket. For terminal-with-cleanup tickets (`INVALID` / `REJECTED` / `EMAIL_FAILED`), the mapping row's own `ttl` already drops it.
7. **S3 cascade**: for every sibling row carrying `s3_key` that is being dropped or anonymised (Raw Upload, Original Receipt, Rendered PDF), the sweeper additionally issues `S3:DeleteObject` against `s3_bucket`/`s3_key`. **SEPA-mandate `pain008_s3_key` is NOT deleted** — see "Anonymisation is not full erasure" below.
8. Lets DDB TTL drop the User Profile item.

**Anonymisation is not full erasure (DSGVO ↔ HGB conflict, locked 2026-06-20).** The cascade leaves three categories of personenbezogene daten intact, by design:

- **Inside the pain.008 audit XML at `pain008_s3_key`** — the file contains the user's full name (`Dbtr.Nm = kontoinhaber_snapshot`), unencrypted IBAN (`DbtrAcct.IBAN`), and BIC (`DbtrAgt.BICFI`). It is **not** rewritten or deleted on user-anonymisation.
- **Inside the camt.054 / pain.002 audit XML at `SepaReport.s3_key`** — bank's response files echo the same fields back. Also retained.
- **`SepaMandate.user_consent_at`** (the date the user clicked-to-sign) survives. The IP and user-agent are nulled, but the existence-of-consent timestamp stays as bookkeeping evidence.

Why this is correct, not a leak:
- HGB §257 + AO §147 require **10-year retention of Buchungsbelege** (financial supporting documents). A pain.008 / camt.054 is exactly that — the legal evidence that we initiated and the bank booked a Lastschrift.
- SEPA-Rulebook (EPC 2017.002, §4.3) requires creditors retain mandates and related transaction records for **at least 14 months after last use**, but the German practical floor is HGB's 10 years.
- DSGVO Art. 17(3)(b) and Art. 17(3)(e) explicitly carve out the right-to-erasure when retention is required for compliance with a legal obligation (HGB/AO) or for the establishment, exercise, or defence of legal claims (a chargeback / R-transaction dispute can land years after the booking).
- DSGVO Art. 5(1)(e) (storage limitation) is satisfied because the retention has a defined endpoint (10y from the financial transaction's date), not "indefinitely".

What the cascade DOES erase reliably:
- All blob bytes carrying PII outside the financial-records scope (raw uploads, rendered EU-form PDFs, belege).
- The user's profile item (DDB-TTL'd).
- The user's name on every ticket and mandate row (nulled at the application layer).
- The ciphertext IBAN/BIC on every ticket and mandate row (`*_enc` attributes removed; the AES-GCM master key isn't rotated, but without the ciphertext the encrypted form is irrecoverable).
- The user's E-Mandat audit-trail metadata except the date (IP + user-agent are PII — they're nulled).
- The PK rewrite (`USER#<email>` → `USER#sha256:<hash>`) breaks the link from anonymised rows back to any other system that knows the user's email.

What the cascade does NOT erase, and why it's documented:
- **pain.008 / camt files in S3.** These are the regulatory artefacts. If they were anonymised, we couldn't defend a Lastschrift dispute years later, and HGB compliance breaks.
- **`SepaMandate.user_consent_at`** date. The mandate-state-machine timeline relies on it; auditors expect to see "when was this mandate signed?" answered.

Result: anonymised tickets and mandates sit in the table without matching User Profile items, and the underlying pain.008 XML in S3 still names the user. That's intentional and DSGVO-compatible. The 10y comes from HGB §257 and AO §147 (buchungsrelevant); after 10y a separate retention-expiry sweeper (out-of-scope v1, mentioned for completeness) would walk these rows + their S3 objects and hard-delete.

---

## Operational notes for the DB person

- **S3 ist nicht in deinem Scope** — backend-team provisioniert die buckets, Lifecycle-Rules und IAM-Policies. DDB-rows haben `s3_bucket` / `s3_key` Attribute (plain strings), aber DB person muss nichts S3-bezogenes provisionieren oder konfigurieren.
- **TransactWriteItems** is used wherever an update needs to be atomic across two items (e.g. anonymisation cascade touching ticket + mandate). 100-item / 4 MB cap per transaction. Backend handles batching.
- **Streams shard count / retention**: not applicable — streams stay disabled (see "Table provisioning" above). No `NEW_IMAGE` view, no event-source mappings.
- **GSI projections matter for cost**: `GSI1` is `ALL` (admin reads everything), `GSI2` and `GSI_EMAIL_PENDING` are `KEYS_ONLY` (the application re-fetches the full item by `PK`/`SK` after a hit), `GSI3` is `ALL` (route-lookup needs delay attributes without re-fetching every segment row). Don't change projections without coordinating.
- **Hot-partition risk on GSI2 + GSI_EMAIL_PENDING**: both use a constant `GSI*_PK` (`"BARCODE"` / `"EMAIL_PENDING"`), which collapses every entry to a single partition key. Acceptable for demo scale (a few hundred tickets); at production scale this would throttle writes. Mitigation if it ever matters: salt the PK (e.g. `BARCODE#<first-byte-of-uid>`) so reads fan out across N partitions. Not done now — flagged.
- **GSI3 partitioning is fine**: `GSI3_PK = "STATION#<eva>#<date>"` fans out across (~200 stations) × (date) — no hot partition concern. Per-day reads concentrate on the requested station, which is by design.
- **Write throughput**: on-demand. Expect peak load during demo: a few uploads/min, dozens of admin queries. No provisioned-capacity tuning needed.

---

## Open items to confirm

1. **Region**: `eu-central-1` (Frankfurt) is the right default for German users. Confirm with whoever holds the AWS account. SES (separate service) sits in the same region; inbound + outbound use the same SES endpoint. AWS regions across services are independent.
2. **Table name**: `railback` lowercase. Pin once provisioned. Backend reads it from env var `RAILBACK_DDB_TABLE` so the actual provisioned name can differ.
3. ~~**S3 bucket layout (1 vs N)**~~ — **locked 2026-06-20: single bucket `railback-storage` with prefixes** (`raw/`, `rendered/`, `belege/`, `pain008/`, `sepa-reports/`). One IAM policy per Lambda role, scoped via prefix. Lifecycle rules per-prefix per the TTL table above. **No `inbound/` prefix** — inbound mail dropped 2026-06-20 (MX → normal mail provider, admin reads in their regular mailclient). See `DECISIONS.md` 2026-06-17 / 2026-06-20.
