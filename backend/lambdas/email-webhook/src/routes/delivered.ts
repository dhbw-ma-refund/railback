// Delivery route — happy-path advance of EMAIL_SENDING+SENT to
// PENDING_DB_PAYMENT+DELIVERED.
//
// Idempotency / out-of-order guards:
//   - Already at the target state → noop (SNS occasionally redelivers).
//   - Ticket already in EMAIL_FAILED (watchdog or earlier permanent bounce
//     fired first) → log warn + noop. A late Delivery must NOT resurrect
//     a terminal ticket. ARCHITECTURE.md: terminal states are terminal.
//   - Any other ticket_state (READY, etc.) → log warn + noop.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import type { Ticket } from "@railback/lib/types/dto";

export async function onDelivered(args: { ticket: Ticket }): Promise<void> {
  const t = args.ticket;

  if (t.ticket_state === "PENDING_DB_PAYMENT" && t.email_status === "DELIVERED") {
    log.info("webhook.delivered.noop", { ticketId: t.ticketId });
    return;
  }

  if (t.ticket_state !== "EMAIL_SENDING") {
    log.warn("webhook.delivered.out_of_order", {
      ticketId: t.ticketId,
      ticket_state: t.ticket_state,
      email_status: t.email_status,
    });
    return;
  }

  await db().tickets.patch(t.email, t.ticketId, {
    ticket_state: "PENDING_DB_PAYMENT",
    email_status: "DELIVERED",
    email_failed_reason: null,
  });
  log.info("webhook.delivered.ok", { ticketId: t.ticketId });
}
