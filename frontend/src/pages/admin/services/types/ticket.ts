/**
 * Ticket-related types mirrored from BACKEND_CONTRACT.md §Ticket management.
 * Money fields are strings (decimals never round-tripped through JS number).
 *
 * The mock response is a flat record with `fahrt_*` and `tatsaechlich_*`
 * prefixed fields plus a `state_timeline` array. We keep the same field
 * names so screens read directly and the merge-back to the contract stays
 * mechanical.
 */
export type TicketState =
  | 'VALIDATING'
  | 'READY'
  | 'EMAIL_SENDING'
  | 'PENDING_DB_PAYMENT'
  | 'APPROVED'
  | 'COMPLETED'
  | 'REJECTED'
  | 'INVALID'
  | 'EMAIL_FAILED';

export const TICKET_STATES: TicketState[] = [
  'VALIDATING',
  'READY',
  'EMAIL_SENDING',
  'PENDING_DB_PAYMENT',
  'APPROVED',
  'COMPLETED',
  'REJECTED',
  'INVALID',
  'EMAIL_FAILED',
];

export interface TicketListItem {
  ticketId: string;
  email: string;
  vorname: string;
  nachname: string;
  ticket_state: TicketState;
  antragsart: string;
  antragsgrund: string[];
  abreisedatum: string;
  abreisebahnhof: string;
  zielbahnhof: string;
  zugnummer_plan: string;
  fahrkartenpreis: string;
  erwartete_erstattung: string;
  delayMinutes: number | null;
  submitted_at: string;
  updated_at: string;
}

export interface TicketTimelineEntry {
  state: TicketState;
  at: string;
  actor: string | null;
}

export interface Ticket extends TicketListItem {
  fahrt_abreisedatum: string;
  fahrt_abreisebahnhof: string;
  fahrt_zielbahnhof: string;
  fahrt_abfahrtszeit_plan: string;
  fahrt_ankunftszeit_plan: string;
  fahrt_zugnummer_plan: string;
  fahrt_zugkategorie_plan: string;
  fahrt_fahrkartennummer: string;
  fahrt_fahrkartenpreis: string;
  tatsaechlich_ankunftsdatum: string | null;
  tatsaechlich_abfahrtszeit: string | null;
  tatsaechlich_ankunftszeit: string | null;
  tatsaechlich_zugnummer: string | null;
  tatsaechlich_verpasster_anschluss_bahnhof: string | null;
  antragstellung_ort: string | null;
  zusaetzliche_angaben: string | null;
  extraction_method: string | null;
  extraction_confidence: number | null;
  barcode_uid: string | null;
  state_timeline: TicketTimelineEntry[];
  has_belege: boolean;
  service_fee_betrag: string | null;
  db_paid_at: string | null;
  admin_note: string | null;
  email_status: string | null;
  email_provider_id: string | null;
  email_failed_reason: string | null;
}

export interface TicketsPage {
  items: TicketListItem[];
  nextCursor?: string;
}
