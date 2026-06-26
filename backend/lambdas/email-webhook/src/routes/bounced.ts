// Bounce route — flip to terminal EMAIL_FAILED + email_status=BOUNCED.
//
// Only patches when the ticket is still in the email-flow window:
//   - EMAIL_SENDING: live send in flight; bounce is decisive.
//   - EMAIL_FAILED: terminal already, but reason may upgrade per precedence.
//
// Every other ticket_state (READY, VALIDATING, PENDING_DB_PAYMENT, APPROVED,
// COMPLETED, REJECTED, INVALID) → log + no-op. Once admin review has begun
// (PENDING_DB_PAYMENT onward) the email artefact has been delivered and a
// late bounce on the user's inbox does not retroactively un-send the PDF;
// reverting the ticket would destroy in-flight admin work. Terminal states
// are sealed by definition.
//
// Reason precedence (DB_SCHEMA.md:413): `bounced > complained > webhook_timeout > max_retries`.
// Within EMAIL_FAILED, `bounced` upgrades a prior softer reason. Idempotency:
// already-bounced ticket → no-op.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import type { Ticket } from "@railback/lib/types/dto";

export async function onBounced(args: {
  ticket: Ticket;
  bounceSubType?: string;
}): Promise<void> {
  const t = args.ticket;

  // Gate on the email-flow window. Out-of-window events (admin-owned or
  // pre-send states) are logged and dropped — see header.
  if (t.ticket_state !== "EMAIL_SENDING" && t.ticket_state !== "EMAIL_FAILED") {
    log.info("webhook.bounced.out_of_window", {
      ticketId: t.ticketId,
      ticket_state: t.ticket_state,
      email_status: t.email_status,
      email_failed_reason: t.email_failed_reason,
    });
    return;
  }

  // Idempotency: same Bounce event re-delivered. Only skip when the ticket
  // already carries the `bounced` terminal cause.
  if (
    t.ticket_state === "EMAIL_FAILED" &&
    t.email_status === "BOUNCED" &&
    t.email_failed_reason === "bounced"
  ) {
    log.info("webhook.bounced.noop", {
      ticketId: t.ticketId,
      email_status: t.email_status,
      email_failed_reason: t.email_failed_reason,
    });
    return;
  }

  await db().tickets.patch(t.email, t.ticketId, {
    ticket_state: "EMAIL_FAILED",
    email_status: "BOUNCED",
    email_failed_reason: "bounced",
  });
  log.warn("webhook.bounced.applied", {
    ticketId: t.ticketId,
    bounceSubType: args.bounceSubType,
    priorState: t.ticket_state,
    priorReason: t.email_failed_reason,
  });
}
