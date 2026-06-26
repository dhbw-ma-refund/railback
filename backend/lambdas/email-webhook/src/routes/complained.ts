// Complaint route — user marked the email as spam. Treat as terminal
// EMAIL_FAILED with `email_failed_reason="complained"`.
//
// Only patches when the ticket is still in the email-flow window:
// {EMAIL_SENDING, EMAIL_FAILED}. Every other state → log + no-op (admin
// owns review from PENDING_DB_PAYMENT onward; terminal states are sealed).
//
// Per ARCHITECTURE.md the EmailStatus enum has no dedicated COMPLAINED
// value; complaint reuses BOUNCED. The categorical reason field
// distinguishes the two for ops + SES-reputation post-mortems.
//
// Reason precedence (DB_SCHEMA.md:413): `bounced > complained > webhook_timeout > max_retries`.
// `complained` upgrades `webhook_timeout` / `max_retries`, but a prior
// `bounced` terminal stays put. Idempotency: already-complained → no-op.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import type { Ticket } from "@railback/lib/types/dto";

export async function onComplained(args: {
  ticket: Ticket;
  feedbackType?: string;
}): Promise<void> {
  const t = args.ticket;

  // Gate on the email-flow window. Out-of-window events are logged + dropped.
  if (t.ticket_state !== "EMAIL_SENDING" && t.ticket_state !== "EMAIL_FAILED") {
    log.info("webhook.complained.out_of_window", {
      ticketId: t.ticketId,
      ticket_state: t.ticket_state,
      email_status: t.email_status,
      email_failed_reason: t.email_failed_reason,
    });
    return;
  }

  // Idempotency on event re-delivery: already complained.
  if (
    t.ticket_state === "EMAIL_FAILED" &&
    t.email_failed_reason === "complained"
  ) {
    log.info("webhook.complained.noop", {
      ticketId: t.ticketId,
      email_status: t.email_status,
      email_failed_reason: t.email_failed_reason,
    });
    return;
  }

  // Precedence: a prior `bounced` terminal is more specific — don't downgrade.
  if (
    t.ticket_state === "EMAIL_FAILED" &&
    t.email_failed_reason === "bounced"
  ) {
    log.info("webhook.complained.skip.bounce_wins", {
      ticketId: t.ticketId,
      email_status: t.email_status,
      email_failed_reason: t.email_failed_reason,
    });
    return;
  }

  await db().tickets.patch(t.email, t.ticketId, {
    ticket_state: "EMAIL_FAILED",
    email_status: "BOUNCED",
    email_failed_reason: "complained",
  });
  log.warn("webhook.complained.applied", {
    ticketId: t.ticketId,
    feedbackType: args.feedbackType,
    priorState: t.ticket_state,
    priorReason: t.email_failed_reason,
  });
}
