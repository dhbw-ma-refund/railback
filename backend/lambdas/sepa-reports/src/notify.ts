// R-tx user-notification email. Sent on REVERSED / DISPUTED decisions
// where the classified reason code has `userNotify=true`. No PDF attachment
// — this is a short informational text/plain notice.
//
// We reuse the shared `sendRawMime` helper from @railback/lib/email/send-email
// so the SES singleton client, transient-error classifier, env-var check, and
// `_setSesClient` test seam are all identical to the refund-email path. This
// module only owns the MIME template (multipart/alternative, text-only).
//
// Contract: throws ONLY on the config-error path (missing RAILBACK_SES_FROM_ADDRESS),
// mirroring sendRefundEmail. Runtime SES failures return an ok=false result
// so the caller can log and keep processing.

import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

import { AppError } from "@railback/lib/errors";
import { sendRawMime } from "@railback/lib/email/send-email";
import type { ReasonOutcome } from "@railback/lib/sepa/reason-codes";

// -- MIME builder ----------------------------------------------------------

function encodeHeaderWord(value: string): string {
  if (/^[\x20-\x7E\t]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function stripHeaderUnsafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\x00]/g, "").replace(/[\x01-\x1F\x7F]/g, " ");
}

interface BuildRtxMimeArgs {
  from: string;
  to: string;
  ticketId: string;
  vorname: string;
  nachname: string;
  action: "REVERSED" | "DISPUTED";
  reasonCode: string;
  reasonDescription: string;
}

function buildRtxMime(args: BuildRtxMimeArgs): string {
  const boundary = "----railback-rtx-" + randomBytes(12).toString("hex");
  const safeVorname = stripHeaderUnsafe(args.vorname);
  const safeNachname = stripHeaderUnsafe(args.nachname);
  const safeTicketId = stripHeaderUnsafe(args.ticketId);
  const safeReason = stripHeaderUnsafe(args.reasonCode);

  const headline =
    args.action === "DISPUTED"
      ? "Service-Gebühr: Rückforderung durch dich"
      : "Service-Gebühr konnte nicht eingezogen werden";
  const subject = `[RailBack #${safeTicketId}] ${headline}`;
  const displayName = `${safeVorname} ${safeNachname}`.trim();
  const toHeader =
    displayName.length > 0
      ? `${encodeHeaderWord(displayName)} <${args.to}>`
      : args.to;

  // Body text — kurz und konkret, kein Marketing.
  const intro =
    args.action === "DISPUTED"
      ? "die Bank hat auf deinen Wunsch die Service-Gebühr für den Antrag oben zurücküberwiesen (MD06)."
      : "die Bank konnte unsere Service-Gebühr für den Antrag oben nicht einziehen.";
  const detail = `Grund (Bank-Code ${safeReason}): ${stripHeaderUnsafe(args.reasonDescription)}.`;
  const outro =
    args.action === "DISPUTED"
      ? "Dein Fahrgastrechte-Antrag bei der Deutschen Bahn bleibt davon unberührt."
      : "Dein Fahrgastrechte-Antrag bei der Deutschen Bahn bleibt davon unberührt. Wir versuchen den Einzug in diesem Fall nicht erneut.";
  const body =
    `Hallo ${safeVorname} ${safeNachname},\r\n` +
    `\r\n` +
    `${intro}\r\n` +
    `\r\n` +
    `${detail}\r\n` +
    `\r\n` +
    `${outro}\r\n` +
    `\r\n` +
    `Antragsnummer: ${safeTicketId}\r\n` +
    `\r\n` +
    `Viele Grüße\r\n` +
    `dein RailBack-Team\r\n`;

  const headers = [
    `From: ${args.from}`,
    `To: ${toHeader}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `MIME-Version: 1.0`,
    `X-Ticket-Id: ${safeTicketId}`,
    `X-Rtx-Action: ${args.action}`,
    `X-Rtx-Reason: ${safeReason}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].join("\r\n");

  const textPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ].join("\r\n");

  return headers + "\r\n\r\n" + textPart + "\r\n" + `--${boundary}--\r\n`;
}

// -- Public API ------------------------------------------------------------

export type SendRtxNotifyResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; transient: boolean };

export interface SendRtxNotifyInput {
  to: string;
  vorname: string;
  nachname: string;
  ticketId: string;
  action: "REVERSED" | "DISPUTED";
  reasonCode: string;
  classified: ReasonOutcome;
}

/**
 * Send an R-tx notification. Only throws on the config-error path (missing
 * RAILBACK_SES_FROM_ADDRESS — same policy as sendRefundEmail). Runtime SES
 * failures return an ok=false result so the caller can log and keep going.
 */
export async function sendRtxNotifyEmail(
  input: SendRtxNotifyInput,
): Promise<SendRtxNotifyResult> {
  const from = process.env["RAILBACK_SES_FROM_ADDRESS"];
  if (!from || from.length === 0) {
    // Same hard-fail policy as the refund helper: an unset From address is
    // a config error, not a runtime hiccup. Bubble up to the handler which
    // logs and continues with the batch — nothing here is user-recoverable.
    throw new AppError("ERR_INTERNAL", "RAILBACK_SES_FROM_ADDRESS not set");
  }

  const rawMime = buildRtxMime({
    from,
    to: input.to,
    ticketId: input.ticketId,
    vorname: input.vorname,
    nachname: input.nachname,
    action: input.action,
    reasonCode: input.reasonCode,
    reasonDescription: input.classified.description,
  });

  return sendRawMime({
    from,
    to: input.to,
    rawMime,
    ticketId: input.ticketId,
    logPrefix: "sepa-reports.notify.send",
    extraLogFields: {
      action: input.action,
      reasonCode: input.reasonCode,
    },
  });
}
