/**
 * User-facing typed wrappers around the shared HTTP client.
 *
 * The transport (fetch + 401 refresh + error unwrap) lives in
 * @shared/api/createClient. This file only knows the endpoint paths and
 * request/response shapes for the user-side routes.
 * Errors thrown from these functions are ApiError instances — inspect
 * .code first (see @shared/api/errors), fall back to .message for display.
 */
import { apiClient } from './api/client';

// ─── Auth + profile ──────────────────────────────────────────────────────

export interface RegisterRequest {
  email: string;
  password: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  /**
   * Bank details are REQUIRED at registration — the backend rejects a
   * missing/blank IBAN or BIC with ERR_VALIDATION. See
   * backend/lib/src/schemas/auth.ts registerRequestSchema.
   */
  iban: string;
  bic: string;
  datenschutz_einwilligung: boolean;
  agb_akzeptiert: boolean;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    email: string;
    vorname: string;
    nachname: string;
    role: string;
  };
}

export interface UserProfile {
  email: string;
  vorname: string;
  nachname: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  user_state: string;
  created_at: string;
}

export interface RefundData {
  vorname: string;
  nachname: string;
  email: string;
  telefon: string;
  adresse: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
  iban: string | null;
  bic: string | null;
}

export interface UpdateProfileRequest {
  vorname?: string;
  nachname?: string;
  telefon?: string;
  adresse?: {
    strasse: string;
    hausnr: string;
    plz: string;
    ort: string;
    land: string;
  };
}

// ─── Ticket / refund enums ───────────────────────────────────────────────
// Values verbatim from backend/lib/src/types/enums.ts. Keep in sync.

export type TicketState =
  | 'VALIDATING'
  | 'READY'
  | 'EMAIL_SENDING'
  | 'PENDING_DB_PAYMENT'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'EMAIL_FAILED'
  | 'INVALID';

export type ExtractionStatus = 'PROCESSING' | 'DONE' | 'FAILED';
export type ExtractionMethod = 'BARCODE' | 'PDF_TEXT' | 'MANUAL' | 'MANUAL_ROUTE';

export type Antragsart =
  | 'ERSTATTUNG_FAHRKARTE'
  | 'ENTSCHAEDIGUNG_60_119'
  | 'ENTSCHAEDIGUNG_120_PLUS'
  | 'ENTSCHAEDIGUNG_ZEITKARTE'
  | 'KOSTEN_ALTERNATIVTRANSPORT';

export type Antragsgrund = 'VERSPAETUNG' | 'AUSFALL' | 'VERPASSTER_ANSCHLUSS';

export type EmailStatus =
  | 'SENDING'
  | 'SENT'
  | 'FAILED_TRANSIENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED';

export type BelegTyp = 'TAXI' | 'BUS' | 'HOTEL' | 'SONSTIGES';

export type SupportedMimeType = 'application/pdf' | 'image/jpeg' | 'image/png';

export type DataQuality = 'FULL' | 'PARTIAL' | 'PLAN_ONLY';

// ─── Ticket types ────────────────────────────────────────────────────────

/** Presigned S3 POST envelope — same shape for /upload and /belege. */
export interface PresignEnvelope {
  uploadUrl: string;
  s3_key: string;
  expiresIn: number;
  fields: Record<string, string>;
}

export interface UploadPresignRequest {
  filename: string;
  mimeType: SupportedMimeType;
}

export interface UploadPresignResponse extends PresignEnvelope {
  ticketId: string;
}

export interface UploadConfirmRequest {
  s3_key: string;
  filename: string;
  mimeType: SupportedMimeType;
}

export interface UploadConfirmResponse {
  ticketId: string;
  extraction_status: ExtractionStatus;
}

export interface TicketStateTimelineEntry {
  state: TicketState;
  at: string; // ISO-8601
}

/** Full ticket view — GET /users/me/tickets/{id}. Never carries iban/bic. */
export interface TicketResponse {
  email: string;
  ticketId: string;
  ticket_state: TicketState;
  state_timeline: TicketStateTimelineEntry[];

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

  email_status?: EmailStatus;
  email_attempts?: number;
  email_last_attempt?: string;
  email_failed_reason?: string;

  uploaded_at?: string;
  submitted_at?: string;
  updated_at: string;
  belege_count?: number;
}

/** Dashboard row projection — GET /users/me/tickets. */
export interface TicketSummary {
  ticketId: string;
  ticket_state: TicketState;
  updated_at: string;
  abreisedatum?: string;
  abreisebahnhof?: string;
  zielbahnhof?: string;
  fahrkartenpreis?: string;
  antragsart?: Antragsart;
  erwartete_erstattung?: string;
  email_status?: EmailStatus;
  submitted_at?: string;
}

export interface ListTicketsResponse {
  items: TicketSummary[];
}

// ─── Route lookup + from-route ───────────────────────────────────────────

export interface RouteLookupRequest {
  /** Either fromStation OR fromEva is required (backend refine). */
  fromStation?: string;
  fromEva?: number;
  /** Either toStation OR toEva is required. */
  toStation?: string;
  toEva?: number;
  date: string; // YYYY-MM-DD
  timeWindow?: { from: string; to: string }; // HH:MM
}

export interface RouteLookupCandidate {
  trainNr: string;
  zugkategorie?: string;
  abfahrt_plan: string;
  ankunft_plan: string;
  abfahrt_tatsaechlich?: string;
  ankunft_tatsaechlich?: string;
  delayMinutes: number;
  any_cancelled: boolean;
  data_quality: DataQuality;
}

export interface RouteLookupResponse {
  candidates: RouteLookupCandidate[];
}

export interface FromRouteRequest {
  ticketId?: string;
  trainNr: string;
  date: string;
  fromStation: string;
  toStation: string;
  abfahrtszeit_plan: string;
  ankunftszeit_plan: string;
  fahrkartennummer: string;
  fahrkartenpreis: string;
  is_zeitkarte?: boolean;
  templateId?: string;
}

export interface FromRouteResponse {
  ticketId: string;
  ticket_state: 'READY';
  extraction_method: 'MANUAL_ROUTE';
  extraction_confidence: 0;
}

// ─── Delays ─────────────────────────────────────────────────────────────

export interface DelaysRequest {
  trainNr: string;
  date: string;
  abreisebahnhof: string;
  zielbahnhof: string;
}

export interface DelaySegment {
  segId: string;
  origin: string;
  destination: string;
  delayMinutes: number;
  reason: string;
  is_cancelled: boolean;
  abfahrtszeit_plan: string;
  abfahrtszeit_tatsaechlich?: string;
  ankunftszeit_plan: string;
  ankunftszeit_tatsaechlich?: string;
}

export interface DelaysResponse {
  trainNr: string;
  date: string;
  segments: DelaySegment[];
  maxDelayMinutes: number;
  any_cancelled: boolean;
  suggested_antragsart: Antragsart;
  data_quality: DataQuality;
}

// ─── Belege ─────────────────────────────────────────────────────────────

export interface BelegPresignRequest {
  filename: string;
  mimeType: SupportedMimeType;
  typ: BelegTyp;
}

export interface BelegPresignResponse extends PresignEnvelope {
  belegId: string;
}

export interface BelegConfirmRequest {
  s3_key: string;
  filename: string;
  mimeType: SupportedMimeType;
  typ: BelegTyp;
  size_bytes: number;
  amount: string; // decimal EUR, "^-?[0-9]+\\.[0-9]{2}$"
}

export interface BelegConfirmResponse {
  belegId: string;
}

// ─── Refund submit ──────────────────────────────────────────────────────

export interface RefundFahrt {
  abreisedatum: string;
  abreisebahnhof: string;
  zielbahnhof: string;
  abfahrtszeit_plan: string;
  ankunftszeit_plan: string;
  zugnummer_plan: string;
  zugkategorie_plan?: string;
  fahrkartennummer: string;
  fahrkartenpreis: string;
}

export interface RefundFahrtTatsaechlich {
  /** Send `null` (not `undefined`) for "not applicable" per contract. */
  ankunftsdatum_tatsaechlich?: string | null;
  abfahrtszeit_tatsaechlich?: string | null;
  ankunftszeit_tatsaechlich?: string | null;
  zugnummer_tatsaechlich?: string | null;
  verpasster_anschluss_bahnhof?: string | null;
}

export interface RefundRequest {
  antragsgrund: Antragsgrund[]; // min length 1
  antragsart: Antragsart;
  is_zeitkarte?: boolean;
  fahrt: RefundFahrt;
  fahrt_tatsaechlich: RefundFahrtTatsaechlich;
  antragstellung_ort: string;
  zusaetzliche_angaben?: string;
  datenschutz_einwilligung: true; // literal
  wahrheitserklaerung: true; // literal
}

export interface RefundResponse {
  ticketId: string;
  ticket_state: 'EMAIL_SENDING' | 'EMAIL_FAILED';
  submitted_at: string;
  email_status: EmailStatus;
  erwartete_erstattung: string;
  service_fee_betrag: string;
}

// ─── Public API ─────────────────────────────────────────────────────────

export const api = {
  // Auth
  register(data: RegisterRequest): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/register', data);
  },

  login(email: string, password: string): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/login', { email, password });
  },

  refresh(refreshToken: string): Promise<AuthResponse> {
    return apiClient.post<AuthResponse>('/auth/refresh', { refreshToken });
  },

  // Profile
  getProfile(): Promise<UserProfile> {
    return apiClient.get<UserProfile>('/users/me');
  },

  updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
    return apiClient.patch<UserProfile>('/users/me', data);
  },

  getRefundData(): Promise<RefundData> {
    return apiClient.get<RefundData>('/users/me/refund-data');
  },

  updateBank(iban: string, bic: string): Promise<{ iban: string; bic: string }> {
    return apiClient.patch<{ iban: string; bic: string }>('/users/me/bank', { iban, bic });
  },

  deleteAccount(confirmPassword: string): Promise<void> {
    // DELETE with a JSON body — supported by the shared client via RequestOptions.body.
    return apiClient.delete<void>('/users/me', { body: { confirmPassword } });
  },

  // Ticket list + read + delete
  getTickets(): Promise<ListTicketsResponse> {
    return apiClient.get<ListTicketsResponse>('/users/me/tickets');
  },

  getTicket(ticketId: string): Promise<TicketResponse> {
    return apiClient.get<TicketResponse>(`/users/me/tickets/${ticketId}`);
  },

  deleteTicket(ticketId: string): Promise<void> {
    return apiClient.delete<void>(`/users/me/tickets/${ticketId}`);
  },

  // Upload flow
  presignUpload(ticketId: string, data: UploadPresignRequest): Promise<UploadPresignResponse> {
    return apiClient.post<UploadPresignResponse>(`/users/me/tickets/${ticketId}/upload`, data);
  },

  confirmUpload(
    ticketId: string,
    data: UploadConfirmRequest,
  ): Promise<UploadConfirmResponse> {
    return apiClient.post<UploadConfirmResponse>(
      `/users/me/tickets/${ticketId}/upload-confirm`,
      data,
    );
  },

  // Route lookup + from-route (static paths — must be routed before /{ticketId}/…)
  routeLookup(data: RouteLookupRequest): Promise<RouteLookupResponse> {
    return apiClient.post<RouteLookupResponse>('/users/me/tickets/route-lookup', data);
  },

  createFromRoute(data: FromRouteRequest): Promise<FromRouteResponse> {
    return apiClient.post<FromRouteResponse>('/users/me/tickets/from-route', data);
  },

  // Delays lookup for an existing ticket
  lookupDelays(ticketId: string, data: DelaysRequest): Promise<DelaysResponse> {
    return apiClient.post<DelaysResponse>(`/users/me/tickets/${ticketId}/delays`, data);
  },

  // Belege
  presignBeleg(ticketId: string, data: BelegPresignRequest): Promise<BelegPresignResponse> {
    return apiClient.post<BelegPresignResponse>(`/users/me/tickets/${ticketId}/belege`, data);
  },

  confirmBeleg(
    ticketId: string,
    belegId: string,
    data: BelegConfirmRequest,
  ): Promise<BelegConfirmResponse> {
    return apiClient.post<BelegConfirmResponse>(
      `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
      data,
    );
  },

  deleteBeleg(ticketId: string, belegId: string): Promise<void> {
    return apiClient.delete<void>(`/users/me/tickets/${ticketId}/belege/${belegId}`);
  },

  // Refund submit
  submitRefund(ticketId: string, data: RefundRequest): Promise<RefundResponse> {
    return apiClient.post<RefundResponse>(`/users/me/tickets/${ticketId}/refund`, data);
  },
};
