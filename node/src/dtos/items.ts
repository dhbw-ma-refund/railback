// Raw DDB item shapes — wire format for DynamoDB. Repos translate between these
// and the DTOs in dto.ts. PK/SK and GSI keys are always present where the
// key-conventions table requires them.

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

export interface StateTimelineEntry {
  state: TicketState;
  at: string;
}

export interface UserProfileItem {
  PK: string;
  SK: "PROFILE";
  GSI1_PK: "USER";
  GSI1_SK: string;
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse_strasse: string;
  adresse_hausnr: string;
  adresse_plz: string;
  adresse_ort: string;
  adresse_land: string;
  hashed_password: string;
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

export interface AdminProfileItem {
  PK: string;
  SK: "PROFILE";
  GSI1_PK: "ADMIN";
  GSI1_SK: string;
  email: string;
  hashed_password: string;
  created_at: string;
}

export interface UserTicketItem {
  PK: string;
  SK: string;
  GSI1_PK?: string;
  GSI1_SK?: string;
  GSI2_PK?: "BARCODE";
  GSI2_SK?: string;
  GSI_EMAIL_PENDING_PK?: "EMAIL_PENDING";
  GSI_EMAIL_PENDING_SK?: string;

  ticketId: string;
  ticket_state: TicketState;
  state_timeline: StateTimelineEntry[];

  extraction_status: ExtractionStatus;
  extraction_method: ExtractionMethod;
  extraction_confidence: number;
  barcode_uid?: string;

  // ticket fields (extracted or user-entered)
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

  // tatsächliche fahrt
  tatsaechlich_ankunftsdatum?: string;
  tatsaechlich_abfahrtszeit?: string;
  tatsaechlich_ankunftszeit?: string;
  tatsaechlich_zugnummer?: string;
  tatsaechlich_verpasster_anschluss_bahnhof?: string;

  // antrag
  antragsgrund?: Antragsgrund[];
  antragsart?: Antragsart;
  is_zeitkarte?: boolean;
  antragstellung_ort?: string;
  antragstellung_datum?: string;
  zusaetzliche_angaben?: string;
  datenschutz_einwilligung?: boolean;
  wahrheitserklaerung?: boolean;

  // computed
  delayMinutes?: number;
  erwartete_erstattung?: string;
  service_fee_betrag?: string;

  // admin
  db_paid_at?: string;
  admin_note?: string;
  service_fee_state?: ServiceFeeState;

  // email
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

  // running count of belege attached pre-submit (KOSTEN_ALTERNATIVTRANSPORT).
  // user-handler bumps on /belege/confirm, decrements on DELETE.
  belege_count?: number;
}

export interface RawUploadItem {
  PK: string;
  SK: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
  ttl?: number;
}

export interface RenderedPdfItem {
  PK: string;
  SK: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  rendered_at: string;
  ttl?: number;
}

export interface OriginalReceiptItem {
  PK: string;
  SK: string;
  filename: string;
  s3_bucket: string;
  s3_key: string;
  content_type: string;
  size_bytes: number; // capped at 5 MB at upload time
  typ: BelegTyp;
  amount: string; // decimal string in EUR; required for KOSTEN_ALTERNATIVTRANSPORT belegeSumme
  uploaded_at: string;
  ttl?: number;
}

export interface SepaMandateItem {
  PK: string;
  SK: string;
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

export type SepaReportType = "PAIN002" | "CAMT054" | "CAMT053";

export interface SepaReportItem {
  PK: string;
  SK: string;
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

export interface RouteTemplateItem {
  PK: string;
  SK: string;
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

export interface TrainSegmentDelayItem {
  PK: string;
  SK: string;
  GSI3_PK: string;
  GSI3_SK: string;
  delayMinutes: number;
  reason: string;
  origin: string;
  destination: string;
  origin_eva: number;
  destination_eva: number;
  planned_departure: string; // HH:MM
  actual_departure?: string;
  planned_arrival: string; // HH:MM
  actual_arrival?: string;
  finalized_at?: string;
  is_cancelled: boolean;
  source: "iris" | "piebro";
  last_seen_at: string;
}

export interface TicketOwnerItem {
  PK: string;
  SK: "OWNER";
  email: string;
  ticketId: string;
  created_at: string;
  ttl?: number;
}
