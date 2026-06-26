// Pass A — retry queue. Reads tickets from GSI_EMAIL_PENDING (oldest-first
// by email_last_attempt) and re-sends them through SES.
//
// Per ticket, the decision tree is:
//   1. Re-load via tickets.get() (optimistic-concurrency guard — the webhook
//      could have flipped the ticket between Query and our patch).
//   2. Skip if state/status moved out of the retry-eligible band, or attempts
//      already hit MAX_ATTEMPTS (defensive — GSI write-side filter should
//      already gate this).
//   3. Load user + rendered PDF bytes from S3. Missing PDF bytes → terminal
//      EMAIL_FAILED with reason="render_missing". The sweeper cannot
//      re-render — that's refund-pdf's job — so endlessly retrying a
//      no-PDF ticket would burn SES quota for nothing.
//   4. Call sendRefundEmail. Branch on result + nextAttempts:
//        ok → SENT (GSI keys cleared automatically by toItem on the patch)
//        non-2xx + permanent → EMAIL_FAILED + reason="max_retries"
//                              (SES error name surfaces via log only;
//                              the DDB column is enum-only per DB_SCHEMA)
//        non-2xx + transient + nextAttempts<3 → FAILED_TRANSIENT (re-enqueued)
//        non-2xx + transient + nextAttempts>=3 → EMAIL_FAILED + reason="max_retries"
//
// Errors thrown inside a per-ticket loop iteration are logged and swallowed
// so one bad ticket doesn't poison the whole pass.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { sendRefundEmail } from "@railback/lib/email/send-email";

const MAX_ATTEMPTS = 3;
// 25 tickets / 5-min cron = comfortably inside the EventBridge window and
// well below SES sandbox throughput (1 req/s) so we never burst-throttle
// ourselves into artificial transient failures.
const DEFAULT_LIMIT = 25;

export interface RunRetryPassArgs {
  now: Date;
  limit?: number;
}

export interface RunRetryPassResult {
  /**
   * Count of tickets the pass actually processed (any branch — success,
   * transient, terminal, or skip-after-re-load). Tickets that throw mid-
   * iteration are still counted: they consumed a queue slot.
   */
  retried: number;
}

export async function runRetryPass(args: RunRetryPassArgs): Promise<RunRetryPassResult> {
  const limit = args.limit ?? DEFAULT_LIMIT;
  const nowIso = args.now.toISOString();
  const queue = await db().tickets.queryEmailPending(limit);

  let retried = 0;
  for (const queued of queue) {
    retried++;
    try {
      await retryOne({ email: queued.email, ticketId: queued.ticketId, nowIso });
    } catch (err) {
      // One ticket blew up. Log + continue — the rest of the pass still runs.
      log.error("email-sweeper.retry.ticket_failed", {
        ticketId: queued.ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { retried };
}

async function retryOne(args: {
  email: string;
  ticketId: string;
  nowIso: string;
}): Promise<void> {
  const { email, ticketId, nowIso } = args;

  // 1. Optimistic-concurrency re-load. Between queryEmailPending and now, the
  //    webhook could have set the ticket to PENDING_DB_PAYMENT (Delivery
  //    event arrived) or EMAIL_FAILED (Bounce/Complaint). Re-fetch and bail.
  const ticket = await db().tickets.get(email, ticketId);
  if (!ticket) {
    log.warn("email-sweeper.retry.ticket_missing", { ticketId });
    return;
  }
  if (ticket.ticket_state !== "EMAIL_SENDING") {
    log.info("email-sweeper.retry.skip.state_changed", {
      ticketId,
      state: ticket.ticket_state,
    });
    return;
  }
  if (ticket.email_status !== "SENDING" && ticket.email_status !== "FAILED_TRANSIENT") {
    log.info("email-sweeper.retry.skip.status_changed", {
      ticketId,
      status: ticket.email_status,
    });
    return;
  }
  const priorAttempts = ticket.email_attempts ?? 0;
  if (priorAttempts >= MAX_ATTEMPTS) {
    // Belt-and-braces against the GSI write-side filter (attempts<3 is
    // already enforced there). Flip to terminal without burning SES.
    log.warn("email-sweeper.retry.budget_exhausted", { ticketId, priorAttempts });
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_last_attempt: nowIso,
      email_failed_reason: "max_retries",
    });
    return;
  }

  // 2. Load user. Orphan ticket = anonymisation race or test inconsistency.
  //    No user → no email address to render onto, no way to forward; flip
  //    terminal with render_missing (semantically: we lack the inputs).
  const user = await db().users.getByEmail(email);
  if (!user) {
    log.error("email-sweeper.retry.user_missing", { ticketId, email });
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_last_attempt: nowIso,
      email_failed_reason: "render_missing",
    });
    return;
  }

  // 3. Load rendered PDF bytes. The sweeper cannot re-render — the PDF was
  //    persisted by refund-pdf and must already exist. Missing metadata or
  //    missing object bytes both go terminal with render_missing.
  const renderedMeta = await db().blobs.getRenderedPdf(email, ticketId);
  if (!renderedMeta) {
    log.error("email-sweeper.retry.rendered_meta_missing", { ticketId });
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_last_attempt: nowIso,
      email_failed_reason: "render_missing",
    });
    return;
  }
  const blob = await db().blobs.getBytes(renderedMeta.s3_key);
  if (!blob) {
    log.error("email-sweeper.retry.rendered_bytes_missing", {
      ticketId,
      s3_key: renderedMeta.s3_key,
    });
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_last_attempt: nowIso,
      email_failed_reason: "render_missing",
    });
    return;
  }

  // 4. Send via SES.
  const nextAttempts = priorAttempts + 1;
  const result = await sendRefundEmail({
    to: email,
    vorname: user.vorname,
    nachname: user.nachname,
    ticketId,
    pdfBytes: blob.bytes,
  });

  // 5. Patch ticket according to SES outcome.
  if (result.ok) {
    await db().tickets.patch(email, ticketId, {
      email_status: "SENT",
      email_attempts: nextAttempts,
      email_last_attempt: nowIso,
      email_provider_id: result.messageId,
      // SENT tickets must not carry a failed_reason (DB_SCHEMA.md restricts
      // it to terminal EMAIL_FAILED). Clear any stale value from a prior
      // FAILED_TRANSIENT attempt.
      email_failed_reason: null,
    });
    log.info("email-sweeper.retry.accepted", {
      ticketId,
      attempts: nextAttempts,
      messageId: result.messageId,
    });
    return;
  }

  // SES rejected.
  if (!result.transient) {
    // Permanent — operator action required (MailFromDomainNotVerified,
    // MessageRejected, ConfigurationSetDoesNotExist, …). Categorical reason
    // is `max_retries` per DB_SCHEMA.md:182 enum (SES never accepted = same
    // bucket as a transient-maxed terminal). SES error name surfaces via the
    // log line below for ops — the DDB column stays inside the enum.
    // Matches refund-pdf's equivalent branch.
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_attempts: nextAttempts,
      email_last_attempt: nowIso,
      email_failed_reason: "max_retries",
    });
    log.error("email-sweeper.retry.permanent", {
      ticketId,
      attempts: nextAttempts,
      error: result.error,
    });
    return;
  }

  if (nextAttempts >= MAX_ATTEMPTS) {
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_attempts: nextAttempts,
      email_last_attempt: nowIso,
      email_failed_reason: "max_retries",
    });
    log.error("email-sweeper.retry.transient_maxed", {
      ticketId,
      attempts: nextAttempts,
      error: result.error,
    });
    return;
  }

  await db().tickets.patch(email, ticketId, {
    email_status: "FAILED_TRANSIENT",
    email_attempts: nextAttempts,
    email_last_attempt: nowIso,
    // Categorical reason is reserved for terminal EMAIL_FAILED.
    email_failed_reason: null,
  });
  log.warn("email-sweeper.retry.transient", {
    ticketId,
    attempts: nextAttempts,
    error: result.error,
  });
}
