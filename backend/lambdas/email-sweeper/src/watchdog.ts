// Pass B — 24h watchdog. Scans for tickets stuck in EMAIL_SENDING+SENT whose
// SNS Delivery event never arrived (or arrived but the webhook failed) and
// flips them to terminal EMAIL_FAILED.
//
// We deliberately do NOT touch email_attempts / email_last_attempt — those
// are SES-side records of what actually happened; clobbering them would
// destroy ops-relevant evidence. Only ticket_state / email_status /
// email_failed_reason move.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";

const DEFAULT_CUTOFF_MINUTES = 24 * 60;

export interface RunWatchdogPassArgs {
  now: Date;
  /**
   * Override the 24h cutoff (in minutes). Used by tests to assert the
   * boundary at deterministic offsets. Defaults to 1440 (24h).
   */
  cutoffMinutes?: number;
}

export interface RunWatchdogPassResult {
  watchdog_timeouts: number;
}

export async function runWatchdogPass(args: RunWatchdogPassArgs): Promise<RunWatchdogPassResult> {
  const cutoffMinutes = args.cutoffMinutes ?? DEFAULT_CUTOFF_MINUTES;
  const cutoffMs = args.now.getTime() - cutoffMinutes * 60_000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const stuck = await db().tickets.scanEmailWatchdog(cutoffIso);
  for (const ticket of stuck) {
    try {
      await db().tickets.patch(ticket.email, ticket.ticketId, {
        ticket_state: "EMAIL_FAILED",
        email_status: "FAILED",
        email_failed_reason: "webhook_timeout",
      });
      log.warn("email-sweeper.watchdog.expired", {
        ticketId: ticket.ticketId,
        email_last_attempt: ticket.email_last_attempt,
      });
    } catch (err) {
      // One ticket blew up — log + continue so the rest of the batch still
      // gets processed.
      log.error("email-sweeper.watchdog.ticket_failed", {
        ticketId: ticket.ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { watchdog_timeouts: stuck.length };
}
