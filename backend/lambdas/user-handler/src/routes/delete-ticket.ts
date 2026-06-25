// DELETE /users/me/tickets/{ticketId}
// - Bearer auth (USER only).
// - SOFT delete via state-transition, NOT a hard row delete: we set
//   ticket_state = INVALID and ttl = now + 90 days (per CLAUDE.md TTL
//   table + ARCHITECTURE.md line 666). The 90d window lets the user
//   see the cancelled application in their history and gives admin a
//   short audit trail for any disputes.
// - 204 No Content on success — there's no useful body, frontend just
//   needs the status code.
// - Idempotent: a second DELETE on an INVALID ticket is a no-op 204.
//   Same rationale as DELETE /users/me — avoids confusing the UI on
//   double-tap.
// - Ownership: tickets.get is keyed on (email, ticketId) so a non-owner
//   gets a 404, not a 403. We never leak existence of someone else's
//   ticket.
// - Refusal cases: a ticket that already went through the money flow
//   (PENDING_DB_PAYMENT / APPROVED / EMAIL_SENDING with a SEPA mandate
//   in flight) shouldn't be deletable — soft-deleting at that point
//   would create a row mismatch with the still-pending SEPA mandate.
//   We block those states with ERR_CONFLICT. The user can call admin
//   for help; admin has the override. Terminal money-flow states
//   (COMPLETED, APPROVED, EMAIL_FAILED) are also blocked because their
//   10y-retention (HGB §257) outranks user-side deletion — those rows
//   live until the anonymisation-sweeper hashes them.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { TicketState } from "@railback/lib/types/enums";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, noContent } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

// States a user is allowed to soft-delete. Anything in the money/email
// pipeline or already terminal is blocked — admin owns those.
// REJECTED carries the SEPA-mandate audit trail and 10y retention for
// accounting (HGB §257); the contract is explicit that REJECTED is a
// terminal state the user cannot soft-delete. INVALID is also listed
// here purely so the idempotent no-op path stays consistent (the
// already-INVALID branch short-circuits above before this check).
const USER_DELETABLE_STATES: ReadonlySet<TicketState> = new Set<TicketState>([
  "VALIDATING",
  "READY",
  "INVALID",
]);

const TTL_AFTER_DELETE_SECONDS = 90 * 24 * 60 * 60;

function readTicketId(event: ApiGwEvent): string | undefined {
  const fromParams = event.pathParameters?.ticketId;
  if (fromParams) return fromParams;
  const path = event.requestContext?.http?.path ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)$/);
  return m?.[1];
}

export async function handleDeleteTicket(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const ticketId = readTicketId(event);
    if (!ticketId) {
      throw new AppError("ERR_VALIDATION", "ticketId path parameter is required");
    }

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `Ticket ${ticketId} not found`);
    }

    // Already-INVALID: idempotent no-op, don't bump the TTL further out.
    if (ticket.ticket_state === "INVALID") {
      return noContent();
    }

    if (!USER_DELETABLE_STATES.has(ticket.ticket_state)) {
      throw new AppError(
        "ERR_CONFLICT",
        `Ticket in state ${ticket.ticket_state} cannot be deleted by user`,
        undefined,
        { current_state: ticket.ticket_state },
      );
    }

    const ttl = Math.floor(Date.now() / 1000) + TTL_AFTER_DELETE_SECONDS;
    await db().tickets.patch(email, ticketId, {
      ticket_state: "INVALID",
      ttl,
    });
    // Align the owner-mapping row's TTL with the parent ticket so the
    // mapping doesn't outlive the ticket lifecycle (CLAUDE.md: mapping
    // TTL spiegelt parent-ticket-TTL).
    await db().ticketOwners.put(ticketId, email, ttl);

    return noContent();
  } catch (err) {
    return errorResponse(err);
  }
}
