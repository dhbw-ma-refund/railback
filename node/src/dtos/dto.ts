// Domain DTOs — what handlers and repos exchange. PK/SK and GSI keys live in
// items.ts; DTOs are the decoded views.

import type {
  Antragsart,
  Antragsgrund,
  BelegTyp,
  EmailStatus,
  ExtractionMethod,
  ExtractionStatus,
  MandateState,
  ServiceFeeState,
  TicketState,
  UserState,
} from "./enums.js";
import type { SepaReportType, StateTimelineEntry } from "./items.js";

export interface Address {
  strasse: string;
  hausnr: string;
  plz: string;
  ort: string;
  land: string;
}

export interface User {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: Address;
  user_state: UserState;
  created_at: string;
  suspended_at?: string;
  suspended_reason?: string;
  iban_enc?: string;
  bic_enc?: string;
  datenschutz_einwilligung: boolean;
  agb_akzeptiert: boolean;
  ttl?: number;
}

// Admin-side view of a UserProfile row. Since the 2026-07-07 reversal
// (DECISIONS.md), admin CAN see IBAN/BIC — the ciphertext (`iban_enc`,
// `bic_enc`) flows through the adapter verbatim, and admin-handler
// decrypts to plaintext before returning it in the API response. The
// adapter still hides the DDB internal `ttl` attribute (never a domain
// concept). Encryption-at-rest is unchanged; the reversal is about
// admin's authority to decrypt what's stored, not about how it's stored.
// See CLAUDE.md "Privacy / admin visibility"; DB_SCHEMA.md
// "Encryption layout"; DECISIONS.md 2026-07-07.
export type UserAdminView = Omit<User, "ttl">;

export interface NewUser {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: Address;
  hashed_password: string;
  // IBAN/BIC are mandatory at registration (locked 2026-06-21). The
  // auth-handler encrypts them via @railback/lib/crypto/iban before
  // handing the NewUser to UserRepo.create.
  iban_enc: string;
  bic_enc: string;
  datenschutz_einwilligung: boolean;
  agb_akzeptiert: boolean;
}

// ProfilePatch is the FULL union of fields any caller (user, admin,
// system task) may write to a UserProfile row. The repo applies whichever
// subset it receives — there is no field-level gate at the repo layer.
//
// Mass-assignment defence lives at each call site:
//   - PATCH /users/me   (lambdas/user-handler): zod-strips iban/bic/
//     user_state/suspended_*, then explicit copy in patch-me.ts only
//     forwards vorname/nachname/telefon/adresse.
//   - PATCH /users/me/bank: only writes iban_enc + bic_enc.
//   - PATCH /admin/users/{email}: admin-handler is the only caller
//     allowed to set user_state / suspended_*; gate is there.
//   - anonymisation-sweeper / scheduleDeletion: write user_state +
//     ttl only.
//
// DO NOT broaden a route to pass parsed.data straight to updateProfile —
// that re-enables mass-assignment across the privacy boundary.
// `clear` carries field names that should be REMOVED from the row (set
// to undefined) — distinct from "field not in patch, leave as-is". Used
// by the admin unban path (clear `suspended_at` / `suspended_reason` /
// `ttl` when SUSPENDED → ACTIVE) and the rescue path (clear `ttl` when
// DELETION_SCHEDULED → ACTIVE).
export type ProfilePatch = Partial<
  Pick<
    User,
    | "vorname"
    | "nachname"
    | "telefon"
    | "adresse"
    | "iban_enc"
    | "bic_enc"
    | "user_state"
    | "suspended_at"
    | "suspended_reason"
    | "ttl"
  >
> & {
  clear?: ReadonlyArray<"suspended_at" | "suspended_reason" | "ttl">;
};

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface UserListQuery {
  emailPrefix?: string;
  state?: UserState;
  limit: number;
  cursor?: string;
}

export interface Ticket {
  email: string;
  ticketId: string;
  ticket_state: TicketState;
  state_timeline: StateTimelineEntry[];

  extraction_status: ExtractionStatus;
  extraction_method: ExtractionMethod;
  extraction_confidence: number;
  barcode_uid?: string;

  vorname_aus_ticket?: string;
  nachname_aus_ticket?: string;
  fahrt_abreisedatum?: string;
  fahrt_abreisebahnhof?: string;
  fahrt_zielbahnhof?: string;
  fahrt_abfahrtszeit_plan?: string;
  fahrt_ankunftszeit_plan?: string;
  fahrt_zugnummer_plan?: string;
  fahrt_zugkategorie_plan?: string;
  fahrt_fahrkartennummer?: string;
  fahrt_fahrkartenpreis?: string;

  tatsaechlich_ankunftsdatum?: string;
  tatsaechlich_abfahrtszeit?: string;
  tatsaechlich_ankunftszeit?: string;
  tatsaechlich_zugnummer?: string;
  tatsaechlich_verpasster_anschluss_bahnhof?: string;

  antragsgrund?: Antragsgrund[];
  antragsart?: Antragsart;
  is_zeitkarte?: boolean;
  antragstellung_ort?: string;
  antragstellung_datum?: string;
  zusaetzliche_angaben?: string;
  datenschutz_einwilligung?: boolean;
  wahrheitserklaerung?: boolean;

  delayMinutes?: number;
  erwartete_erstattung?: string;
  service_fee_betrag?: string;

  db_paid_at?: string;
  admin_note?: string;
  service_fee_state?: ServiceFeeState;

  email_status?: EmailStatus;
  email_attempts?: number;
  email_last_attempt?: string;
  email_provider_id?: string;
  email_failed_reason?: string;

  uploaded_at?: string;
  submitted_at?: string;
  updated_at: string;
  ttl?: number;
  archive_ttl?: number;

  belege_count?: number;
}

export interface NewTicket {
  email: string;
  ticketId: string;
  filename: string;
  s3_key: string;
  mimeType: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface NewRouteTicket {
  email: string;
  ticketId: string;
  trainNr: string;
  date: string;
  fromStation: string;
  fromEva: number;
  toStation: string;
  toEva: number;
  abfahrtszeit_plan: string;
  ankunftszeit_plan: string;
  fahrkartennummer: string;
  fahrkartenpreis: string;
  is_zeitkarte: boolean;
  templateId?: string;
}

// `null` in a patch value means "clear this attribute" — repo impls translate
// it to a DDB REMOVE / mock delete. Currently used for:
//   - `email_failed_reason` (must be cleared when transitioning out of
//     FAILED_TRANSIENT — DB_SCHEMA.md constrains the field to be set only
//     on terminal EMAIL_FAILED).
//   - The render-fail rollback path in refund-pdf, which un-submits a
//     ticket back to READY when render/persist deterministically fails.
//     Rollback clears the submit-time fields so the user's wizard retry
//     starts from a clean slate (form data stays as prefill).
export type TicketPatch =
  Partial<Omit<Ticket, "email" | "ticketId" | "email_failed_reason">> & {
    email_failed_reason?: string | null;
    /**
     * Field names that should be REMOVED from the row (set to undefined)
     * by the repo. Distinct from "field not in patch, leave as-is".
     * Used by the render-fail rollback path in refund-pdf — see
     * `lambdas/refund-pdf/src/handler.ts`.
     */
    clear?: ReadonlyArray<
      | "submitted_at"
      | "email_status"
      | "email_attempts"
      | "email_last_attempt"
      | "email_provider_id"
    >;
  };

export interface AdminTicketQuery {
  state?: TicketState;
  email?: string;
  trainNr?: string;
  date?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
  cursor?: string;
}

// RouteTemplate DTO uses snake_case for the route fields (mirrors the
// DDB item layout under `lib/src/storage/ddb/keys.ts` conventions).
// The wire-layer zod schema in `lib/src/schemas/route-template.ts`
// uses camelCase (fromStation/fromEva/...) per the userforms API
// contract — Lambda handlers map between the two shapes.
export interface RouteTemplate {
  email: string;
  templateId: string;
  label: string;
  from_station: string;
  from_eva: number;
  to_station: string;
  to_eva: number;
  fahrkartennummer?: string;
  fahrkartenpreis?: string;
  zugkategorie_pref?: string;
  created_at: string;
  updated_at: string;
}

// NewRouteTemplate carries the frontend-allocated templateId. The
// resolver (`@railback/lib/refund/stations.resolveStation`) is the
// Lambda's responsibility: it takes the wire-shape's fromStation /
// toStation strings and fills both *_station and *_eva on this DTO
// before calling RouteTemplateRepo.create.
export interface NewRouteTemplate {
  templateId: string;
  label: string;
  from_station: string;
  from_eva: number;
  to_station: string;
  to_eva: number;
  fahrkartennummer?: string;
  fahrkartenpreis?: string;
  zugkategorie_pref?: string;
}

export type RouteTemplatePatch = Partial<Omit<NewRouteTemplate, "templateId">>;

export interface SepaMandate {
  email: string;
  ticketId: string;
  mandate_id: string;
  mandate_state: MandateState;
  sequence_type: "OOFF";
  fee_amount: string;
  iban_enc: string;
  bic_enc: string;
  kontoinhaber_snapshot: string;
  user_consent_at: string;
  user_consent_ip?: string;
  user_consent_user_agent?: string;
  vorabankuendigung_sent_at?: string;
  pain008_built_at?: string;
  pain008_batch_id?: string;
  pain008_s3_key?: string;
  pain008_submitted_at?: string;
  debited_at?: string;
  reversed_at?: string;
  reversed_reason?: string;
  dispute_opened_at?: string;
  expires_at: string;
  issued_at: string;
  ttl?: number;
}

export interface NewMandate {
  ticketId: string;
  fee_amount: string;
  iban_enc: string;
  bic_enc: string;
  kontoinhaber_snapshot: string;
  user_consent_at: string;
  user_consent_ip?: string;
  user_consent_user_agent?: string;
  vorabankuendigung_sent_at?: string;
}

export interface SepaReport {
  date: string;
  reportId: string;
  report_type: SepaReportType;
  s3_bucket: string;
  s3_key: string;
  sender: string;
  ingest_source: "MANUAL_UPLOAD";
  mandates_correlated: string[];
  parsed_at: string;
  received_at: string;
  ttl?: number;
}

export interface NewSepaReport {
  date: string;
  reportId: string;
  report_type: SepaReportType;
  s3_bucket: string;
  s3_key: string;
  sender: string;
  mandates_correlated: string[];
  received_at: string;
  /**
   * Unix epoch seconds. 10-year archive per HGB §257 / AO §147 —
   * buchungsrelevant audit row. See DB_SCHEMA.md TTL table.
   * Callers should stamp `received_at + SEPA_REPORT_TTL_SECONDS`.
   */
  ttl: number;
}

export interface RawUpload {
  email: string;
  ticketId: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  ttl?: number;
}

export interface RawUploadInput {
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  ttl?: number;
}

export interface RenderedPdf {
  email: string;
  ticketId: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  rendered_at: string;
  ttl?: number;
}

export interface RenderedPdfInput {
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  rendered_at: string;
  ttl?: number;
}

export interface Receipt {
  email: string;
  ticketId: string;
  belegId: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  typ: BelegTyp;
  amount: string; // decimal EUR; summed into belegeSumme for KOSTEN_ALTERNATIVTRANSPORT
  uploaded_at: string;
  ttl?: number;
}

export interface ReceiptInput {
  belegId: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  typ: BelegTyp;
  amount: string;
  uploaded_at: string;
  ttl?: number;
}

export interface PresignedPost {
  url: string;
  fields: Record<string, string>;
  key: string;
  expiresIn: number;
}

export interface SegmentDelay {
  trainNr: string;
  date: string;
  segId: string;
  delayMinutes: number;
  reason: string;
  origin: string;
  destination: string;
  origin_eva: number;
  destination_eva: number;
  planned_departure: string;
  actual_departure?: string;
  planned_arrival: string;
  actual_arrival?: string;
  finalized_at?: string;
  is_cancelled: boolean;
  source: "iris" | "piebro";
  last_seen_at: string;
}

export interface Admin {
  email: string;
  created_at: string;
}

// Internal-only auth view. Carries the hashed_password + minimal account
// metadata the auth-handler needs to authenticate a login or refresh
// request. Never returned by user-facing endpoints; the regular User
// and Admin DTOs intentionally hide hashed_password.
export interface UserAuthLookup {
  kind: "user";
  email: string;
  vorname: string;
  nachname: string;
  hashed_password: string;
  user_state: UserState;
  suspended_reason?: string;
}

export interface AdminAuthLookup {
  kind: "admin";
  email: string;
  hashed_password: string;
}

export interface TicketOwner {
  ticketId: string;
  email: string;
  created_at: string;
  ttl?: number;
}
