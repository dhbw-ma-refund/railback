import type { TicketState } from './types/ticket';

/**
 * Admin-side allowed state transitions per BACKEND_CONTRACT.md
 * §Ticket management → PATCH /admin/tickets/{ticketId}.
 *
 * Backend rejects any other transition with 409 ERR_CONFLICT. The dialog
 * uses this table to render only reachable targets so the admin never
 * proposes a forbidden move.
 */
export const ADMIN_TICKET_TRANSITIONS: Readonly<Record<TicketState, readonly TicketState[]>> = {
  PENDING_DB_PAYMENT: ['APPROVED', 'REJECTED', 'INVALID'],
  APPROVED: ['COMPLETED', 'REJECTED', 'INVALID'],
  REJECTED: ['INVALID'],
  COMPLETED: [],
  INVALID: [],
  // System-owned states — admin cannot transition out of these.
  VALIDATING: [],
  READY: [],
  EMAIL_SENDING: [],
  EMAIL_FAILED: [],
};

/**
 * Human-readable state labels. Kept German to match the rest of the admin
 * copy in the app.
 */
export const TICKET_STATE_LABELS: Readonly<Record<TicketState, string>> = {
  VALIDATING: 'In Prüfung',
  READY: 'Bereit',
  EMAIL_SENDING: 'E-Mail wird versendet',
  PENDING_DB_PAYMENT: 'Wartet auf DB-Zahlung',
  APPROVED: 'Genehmigt',
  COMPLETED: 'Abgeschlossen',
  REJECTED: 'Abgelehnt',
  INVALID: 'Ungültig',
  EMAIL_FAILED: 'E-Mail fehlgeschlagen',
};

/**
 * Category tables for the state-override dialog copy. Static per state, so
 * a plain lookup record beats a Set here (no dynamic membership).
 */
export const SYSTEM_OWNED_TICKET_STATES: Readonly<Partial<Record<TicketState, true>>> = {
  VALIDATING: true,
  READY: true,
  EMAIL_SENDING: true,
  EMAIL_FAILED: true,
};

/** Terminal states — no further transitions in either direction. */
export const TERMINAL_TICKET_STATES: Readonly<Partial<Record<TicketState, true>>> = {
  COMPLETED: true,
  REJECTED: true,
  INVALID: true,
};
