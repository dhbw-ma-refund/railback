// Admin-driven state transitions for User and Ticket. Centralised so the
// PATCH /admin/users/{email} and PATCH /admin/tickets/{ticketId} routes
// both go through the same allow-list.
//
// Tables match API_CONTRACT_ADMINFORMS.md + CLAUDE.md "Admin user
// management" / "Admin endpoints".

import { AppError } from "@railback/lib/errors";
import type { TicketState, UserState } from "@railback/lib/types/enums";

// --- User ---------------------------------------------------------------

// (from, to) pairs admin is allowed to drive. Includes ACTIVE→ACTIVE
// no-op (the patch handler accepts it only when accompanied by other
// profile field changes — that gate lives in the route, not here).
const USER_TRANSITIONS: ReadonlySet<string> = new Set([
  "ACTIVE→SUSPENDED",
  "SUSPENDED→ACTIVE",
  "SUSPENDED→DELETION_SCHEDULED",
  "ACTIVE→DELETION_SCHEDULED",
  "DELETION_SCHEDULED→ACTIVE",
  // No-op transitions — handler still calls assertUserTransition, which
  // accepts these; the rule "user_state alone is not a useful patch" is
  // enforced in the route.
  "ACTIVE→ACTIVE",
  "SUSPENDED→SUSPENDED",
  "DELETION_SCHEDULED→DELETION_SCHEDULED",
]);

export function isUserTransitionAllowed(
  from: UserState,
  to: UserState,
): boolean {
  return USER_TRANSITIONS.has(`${from}→${to}`);
}

export function assertUserTransition(from: UserState, to: UserState): void {
  if (!isUserTransitionAllowed(from, to)) {
    throw new AppError(
      "ERR_CONFLICT",
      `user_state transition ${from} → ${to} is not allowed`,
      undefined,
      { from, to },
    );
  }
}

// --- Ticket -------------------------------------------------------------

const TICKET_TRANSITIONS: ReadonlySet<string> = new Set([
  "PENDING_DB_PAYMENT→APPROVED",
  "PENDING_DB_PAYMENT→REJECTED",
  "APPROVED→COMPLETED",
  "APPROVED→REJECTED",
  // any non-terminal → INVALID
  "VALIDATING→INVALID",
  "READY→INVALID",
  "EMAIL_SENDING→INVALID",
  "PENDING_DB_PAYMENT→INVALID",
  "APPROVED→INVALID",
]);

// EMAIL_FAILED is fully terminal for admin — every other "system-owned"
// from-state (VALIDATING / READY / EMAIL_SENDING) is already excluded by
// `TICKET_TRANSITIONS` except for the force-invalidate INVALID escape, so
// the explicit EMAIL_FAILED check is the only protection that isn't
// already enforced by the allow-list below.
const TERMINAL_FROM: ReadonlySet<TicketState> = new Set<TicketState>([
  "EMAIL_FAILED",
]);

export function isTicketTransitionAllowed(
  from: TicketState,
  to: TicketState,
): boolean {
  if (from === to) return false;
  return TICKET_TRANSITIONS.has(`${from}→${to}`);
}

export function assertTicketTransition(
  from: TicketState,
  to: TicketState,
): void {
  if (TERMINAL_FROM.has(from)) {
    throw new AppError(
      "ERR_CONFLICT",
      `ticket_state transition ${from} → ${to} is not allowed (system-owned terminal)`,
      undefined,
      { from, to },
    );
  }
  if (!isTicketTransitionAllowed(from, to)) {
    throw new AppError(
      "ERR_CONFLICT",
      `ticket_state transition ${from} → ${to} is not allowed`,
      undefined,
      { from, to },
    );
  }
}
