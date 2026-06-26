// refund-pdf entrypoint — sync-invoked from user-handler POST /refund.
//
// Pipeline:
//   1. Load ticket; guard EMAIL_SENDING + idempotent on SENT/DELIVERED or
//      any prior email_provider_id (once SES has a MessageId, re-send is
//      never correct).
//   2. Enforce 3-attempt budget: if email_attempts >= 3, flip to terminal
//      EMAIL_FAILED without touching SES.
//   3. Load user; resolve IBAN/BIC from SepaMandate snapshot (preferred)
//      or fall back to user.iban_enc/bic_enc (zero-fee path).
//   4. Render EU-form via pdf-lib (fill, flatten).
//   5. Merge belege (PDFs verbatim, images embedded; oversize → notice page).
//   6. Persist merged bytes to S3 + write RENDERED# DDB metadata row.
//   7. Send via SES (sesv2 SendEmailCommand, raw MIME, X-Ticket-Id header).
//   8. Branch on SES result:
//        ok → email_status = SENT, email_provider_id set, failed_reason cleared
//        transient + attempts<3 → email_status = FAILED_TRANSIENT, attempts++
//        transient + attempts>=3 → escalate to EMAIL_FAILED + max_retries
//        permanent → ticket_state = EMAIL_FAILED, email_status = FAILED
//
// Render/persist failures (steps 4-6) ROLL THE TICKET BACK to READY so
// the user can resubmit — the sweeper can only resend already-persisted
// PDFs, so a no-PDF ticket in FAILED_TRANSIENT would be stuck forever.
// The thrown error becomes a 5xx via user-handler's errorResponse.
//
// SES failures are NOT re-thrown — they are normal retry-queue paths and
// the persisted PDF is what the sweeper resends.

import { AppError } from "@railback/lib/errors";
import { log } from "@railback/lib/http/logging";
import { db } from "@railback/lib/storage";
import { DecryptionFailedError, decryptBic, decryptIban } from "@railback/lib/crypto/iban";
import type { TicketPatch } from "@railback/lib/types/dto";

import { fillEuForm } from "./fill-eu-form.js";
import { mergeBelege } from "./merge-belege.js";
import { persistRenderedPdf } from "./persist.js";
import { sendRefundEmail } from "./send-email.js";

export interface RenderAndSendArgs {
  email: string;
  ticketId: string;
}

const MAX_ATTEMPTS = 3;

/**
 * Resolve IBAN + BIC for the EU-form. Preferred source is the SepaMandate
 * snapshot (locked at /refund submit-time, per CLAUDE.md). Falls back to
 * the live user profile when no mandate row exists (zero-fee waiver path).
 *
 * Throws ERR_INTERNAL if neither source carries usable bank data, or if
 * the decrypt fails (corrupted ciphertext / KEK rotation — operator must
 * intervene; refund-pdf can't proceed without a valid IBAN/BIC).
 */
async function resolveBankData(args: {
  email: string;
  ticketId: string;
  userIbanEnc: string | undefined;
  userBicEnc: string | undefined;
}): Promise<{ iban: string; bic: string }> {
  const mandate = await db().mandates.get(args.email, args.ticketId);
  const ibanEnc = mandate?.iban_enc ?? args.userIbanEnc;
  const bicEnc = mandate?.bic_enc ?? args.userBicEnc;
  if (!ibanEnc || !bicEnc) {
    throw new AppError(
      "ERR_INTERNAL",
      "no IBAN/BIC available for refund render (neither mandate snapshot nor user profile)",
    );
  }
  try {
    return { iban: decryptIban(ibanEnc), bic: decryptBic(bicEnc) };
  } catch (err) {
    if (err instanceof DecryptionFailedError) {
      throw new AppError(
        "ERR_INTERNAL",
        "IBAN/BIC ciphertext could not be decrypted",
      );
    }
    throw err;
  }
}

/**
 * Render the EU-form PDF, persist it to S3, and send the user a copy via SES.
 * Sync-invoked from user-handler post-refund.
 */
export async function renderAndSend(args: RenderAndSendArgs): Promise<void> {
  const { email, ticketId } = args;

  // 1. Load ticket.
  const ticket = await db().tickets.get(email, ticketId);
  if (!ticket) {
    throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
  }

  // 2. State guard. user-handler put us in EMAIL_SENDING; anything else means
  //    the sweeper or the webhook already moved the ticket — bail without
  //    side effects.
  if (ticket.ticket_state !== "EMAIL_SENDING") {
    log.warn("refund-pdf.skip.unexpected_state", {
      ticketId,
      ticket_state: ticket.ticket_state,
    });
    return;
  }

  // 3. Idempotency. SENT means SES already accepted the message and we're
  //    waiting on the SNS delivery callback; DELIVERED means it landed.
  //    Re-rendering would create a duplicate email. We ALSO short-circuit
  //    if email_provider_id is set regardless of status — once SES has
  //    issued a MessageId for this ticket, re-sending is never correct
  //    (this catches the case where the post-SES patch failed last time
  //    and left status="SENDING" with provider_id already populated).
  if (
    ticket.email_status === "SENT" ||
    ticket.email_status === "DELIVERED" ||
    (ticket.email_provider_id !== undefined && ticket.email_provider_id.length > 0)
  ) {
    log.info("refund-pdf.skip.already_sent", {
      ticketId,
      email_status: ticket.email_status,
      hasProviderId: ticket.email_provider_id !== undefined,
    });
    return;
  }

  const priorAttempts = ticket.email_attempts ?? 0;

  // 4. Retry-budget guard. If a buggy sweeper or manual re-invoke arrives
  //    with attempts already at the cap, we flip to terminal EMAIL_FAILED
  //    without touching SES (no point sending a 4th request).
  if (priorAttempts >= MAX_ATTEMPTS) {
    const now = new Date().toISOString();
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_last_attempt: now,
      email_failed_reason: "max_retries",
    });
    log.warn("refund-pdf.budget.exhausted", { ticketId, priorAttempts });
    return;
  }

  // 5. Load user.
  const user = await db().users.getByEmail(email);
  if (!user) {
    // Ticket exists but the user row vanished — anonymisation race. The
    // ticket is in an unrecoverable state; surface as 5xx so the caller
    // can decide what to do.
    throw new AppError(
      "ERR_INTERNAL",
      `user ${email} not found for ticket ${ticketId}`,
    );
  }

  // 6. Resolve bank data (mandate snapshot preferred).
  const { iban, bic } = await resolveBankData({
    email,
    ticketId,
    userIbanEnc: user.iban_enc,
    userBicEnc: user.bic_enc,
  });

  const nextAttempts = priorAttempts + 1;
  const nowAttempt = new Date().toISOString();

  // 7. Render + merge + persist. A failure here is structurally different
  //    from an SES rejection: the email-sweeper resends the ALREADY-
  //    PERSISTED PDF and cannot re-render. Putting a no-PDF ticket into
  //    FAILED_TRANSIENT would leave it stuck in the sweeper's retry queue
  //    forever with nothing to send. Instead we ROLL THE TICKET BACK to
  //    READY, clear the submit-time fields, and re-throw so user-handler
  //    returns 5xx. The user can resubmit the wizard; the SepaMandate
  //    row (already issued by user-handler.post-refund) is idempotent
  //    via the "skip-if-exists" guard there.
  //
  //    Form-data fields (antragsart, fahrt_*, erwartete_erstattung, ...)
  //    stay populated as prefill for the retry.
  let mergedBytes: Uint8Array;
  try {
    const euFormBytes = await fillEuForm({ ticket, user, iban, bic });
    const belege = await db().blobs.listReceipts(email, ticketId);
    const merged = await mergeBelege({
      euFormBytes,
      belege: belege.map((b) => ({
        s3_key: b.s3_key,
        content_type: b.content_type,
        filename: b.filename,
      })),
    });
    await persistRenderedPdf({ email, ticketId, bytes: merged.bytes });
    mergedBytes = merged.bytes;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("refund-pdf.render.failed", { ticketId, message, attempt: nextAttempts });
    // Roll back to READY so the user can resubmit. Clear the submit-time
    // fields; leave the form-data fields (they're useful as prefill).
    await db().tickets.patch(email, ticketId, {
      ticket_state: "READY",
      email_failed_reason: null,
      clear: [
        "submitted_at",
        "email_status",
        "email_attempts",
        "email_last_attempt",
        "email_provider_id",
      ],
    });
    // Re-throw so the inline caller (user-handler post-refund) returns 5xx.
    // The ticket is now back in READY, which post-refund's state guard
    // accepts as a valid submit-from state.
    throw err;
  }

  // 8. Send via SES.
  const result = await sendRefundEmail({
    to: email,
    vorname: user.vorname,
    nachname: user.nachname,
    ticketId,
    pdfBytes: mergedBytes,
  });

  // 9. Patch ticket according to SES outcome.
  if (result.ok) {
    // SES accepted the message. We're awaiting the SNS Delivery event
    // (handled by email-webhook), so the ticket stays in EMAIL_SENDING
    // but email_status flips to SENT — sweeper retry queue is cleared.
    // Also clear any stale email_failed_reason from a prior FAILED_TRANSIENT
    // attempt — DB_SCHEMA.md constrains the field to terminal EMAIL_FAILED.
    const patch: TicketPatch = {
      email_status: "SENT",
      email_attempts: nextAttempts,
      email_last_attempt: nowAttempt,
      email_provider_id: result.messageId,
      email_failed_reason: null,
    };
    await db().tickets.patch(email, ticketId, patch);
    log.info("refund-pdf.ses.accepted", {
      ticketId,
      messageId: result.messageId,
      attempts: nextAttempts,
    });
    return;
  }

  // SES rejected the message.
  // - Permanent rejection → terminal EMAIL_FAILED with categorical reason.
  // - Transient rejection at attempts < 3 → FAILED_TRANSIENT (sweeper retries).
  // - Transient rejection at attempts >= 3 → terminal EMAIL_FAILED ("max_retries"),
  //   matching ARCHITECTURE.md "attempt 3 fail → EMAIL_FAILED".
  if (!result.transient) {
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_attempts: nextAttempts,
      email_last_attempt: nowAttempt,
      // Permanent SES rejection = SES never accepted = same bucket as
      // max_retries for DB_SCHEMA's categorical reason. The actual SES
      // error name leaks via the ses.send.fail log line for ops.
      email_failed_reason: "max_retries",
    });
    log.error("refund-pdf.ses.permanent", {
      ticketId,
      error: result.error,
      attempts: nextAttempts,
    });
    return;
  }

  if (nextAttempts >= MAX_ATTEMPTS) {
    await db().tickets.patch(email, ticketId, {
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
      email_attempts: nextAttempts,
      email_last_attempt: nowAttempt,
      email_failed_reason: "max_retries",
    });
    log.error("refund-pdf.ses.transient.maxed", {
      ticketId,
      error: result.error,
      attempts: nextAttempts,
    });
    return;
  }

  await db().tickets.patch(email, ticketId, {
    email_status: "FAILED_TRANSIENT",
    email_attempts: nextAttempts,
    email_last_attempt: nowAttempt,
    // Categorical reason is reserved for terminal EMAIL_FAILED; clear here.
    email_failed_reason: null,
  });
  log.warn("refund-pdf.ses.transient", {
    ticketId,
    error: result.error,
    attempts: nextAttempts,
  });
}
