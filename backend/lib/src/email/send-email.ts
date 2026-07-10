// SES outbound for the rendered EU-form PDF.
//
// Sync first attempt comes from refund-pdf; attempts 2-3 from email-sweeper.
// We hand-roll the MIME (multipart/mixed, plaintext body + PDF attachment) to
// avoid pulling in nodemailer just for that. SESv2 SendEmailCommand accepts
// the raw bytes via Content.Raw.Data.
//
// Custom header `X-Ticket-Id` is critical — the SES Configuration-Set event
// destination forwards it via SNS to `email-webhook`, which uses it to
// correlate the delivery/bounce event back to the ticket row.
//
// This function never throws. The caller decides what to do with a failure
// (set FAILED_TRANSIENT + bump attempts, or set FAILED). The retry budget
// itself lives in the handler/sweeper.

import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";

import { AppError } from "../errors/index.js";
import { log } from "../http/logging.js";

// SES error classification.
//
// We INVERT the classic allowlist-of-permanent-names approach: maintain an
// explicit TRANSIENT set (network blips, throttling, 5xx) and treat
// EVERYTHING ELSE as permanent. Rationale: this is a billing-sensitive flow
// (each retry burns SES quota + sweeper cycles) and an unknown error name
// almost always means "config/permissions broken — won't fix itself".
// Notable callouts:
//   - AccountSendingPausedException is intentionally NOT permanent — SES
//     auto-unpauses on reputation recovery; the sweeper retry window is the
//     right place to wait it out (will eventually fall off via max_retries).
//   - LimitExceededException / AccessDeniedException / ValidationException /
//     BadRequestException are all permanent (they require operator action).
const TRANSIENT_ERROR_NAMES = new Set<string>([
  // Network / SDK level
  "TimeoutError",
  "NetworkingError",
  "RequestTimeout",
  "RequestTimeoutException",
  "AbortError",
  // Server-side load
  "ThrottlingException",
  "Throttling",
  "TooManyRequestsException",
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalFailure",
  "InternalServerError",
  // SES-specific transient signals
  "AccountSendingPausedException",
  "SendingPausedException",
]);

export function isTransientSesError(name: string): boolean {
  return TRANSIENT_ERROR_NAMES.has(name);
}

let sesClient: SESv2Client | null = null;

function getClient(): SESv2Client {
  if (sesClient !== null) return sesClient;
  const region = process.env["RAILBACK_AWS_REGION"] ?? "eu-north-1";
  sesClient = new SESv2Client({ region });
  return sesClient;
}

/** Test seam — inject a mock client, or pass null to reset. */
export function _setSesClient(c: SESv2Client | null): void {
  sesClient = c;
}

/**
 * RFC 2047 encoded-word for a header value that may contain non-ASCII chars.
 * Always emits a single base64 encoded-word; long values would technically
 * need to be split into multiple words, but our names + ticket-ids stay
 * well under the 75-char limit per word.
 *
 * Note: the fast path only matches printable ASCII (\x20-\x7E plus tab).
 * Control bytes — most importantly CR (\x0D) and LF (\x0A) — force the
 * base64 path so they can never escape into a header line. See also
 * stripHeaderUnsafe() at the boundary; we belt-and-braces both.
 */
function encodeHeaderWord(value: string): string {
  // Printable-ASCII fast path. Excludes CR/LF/NUL/control bytes — those
  // would break MIME header semantics if emitted raw (CRLF-injection),
  // so they take the base64 branch instead.
  if (/^[\x20-\x7E\t]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Defensive scrub for user-controlled strings that land in MIME headers
 * (display-name, subject, ticketId). Drops CR/LF/NUL outright so even if
 * encodeHeaderWord were ever bypassed, header-injection cannot happen.
 * Other control bytes get replaced with a space to keep header parsing sane.
 */
function stripHeaderUnsafe(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\r\n\x00]/g, "").replace(/[\x01-\x1F\x7F]/g, " ");
}

function wrapBase64(b64: string): string {
  // SES is fine with long lines but MIME spec says 76 chars max.
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function buildMime(args: {
  from: string;
  to: string;
  ticketId: string;
  vorname: string;
  nachname: string;
  pdfBytes: Uint8Array;
}): string {
  const boundary = "----railback-" + randomBytes(12).toString("hex");
  // Sanitize all user-controlled inputs at the boundary: vorname/nachname
  // are validated as min(1).max(100) but the schema has no character class,
  // so a malicious registration could carry CR/LF and inject extra headers
  // (e.g. Bcc:) when interpolated below. ticketId is ulid-shaped today but
  // we belt-and-brace it too. encodeHeaderWord's base64 branch is the
  // second line of defense.
  const safeVorname = stripHeaderUnsafe(args.vorname);
  const safeNachname = stripHeaderUnsafe(args.nachname);
  const safeTicketId = stripHeaderUnsafe(args.ticketId);
  const subject = `[RailBack #${safeTicketId}] Ihr Fahrgastrechte-Formular`;
  const filename = `fahrgastrechte-${safeTicketId}.pdf`;
  const displayName = `${safeVorname} ${safeNachname}`.trim();

  const toHeader = displayName.length > 0
    ? `${encodeHeaderWord(displayName)} <${args.to}>`
    : args.to;

  // Body is plain text, so CR/LF in vorname/nachname can't escape into
  // headers — but we still use the sanitized values so a tabbed display
  // name doesn't render weirdly in the user's client.
  const body =
    `Hallo ${safeVorname} ${safeNachname},\r\n` +
    `\r\n` +
    `anbei das ausgefüllte EU-Fahrgastrechte-Formular für deinen Antrag ${safeTicketId}.\r\n` +
    `\r\n` +
    `Bitte reiche das PDF bei der Deutschen Bahn ein — entweder über fahrgastrechte.bahn.de,\r\n` +
    `per Post oder in einem DB-Reisezentrum. Die Auszahlung erfolgt direkt durch die DB.\r\n` +
    `\r\n` +
    `Viele Grüße\r\n` +
    `dein RailBack-Team\r\n`;

  const pdfB64 = wrapBase64(Buffer.from(args.pdfBytes).toString("base64"));

  const headers = [
    `From: ${args.from}`,
    `To: ${toHeader}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    `MIME-Version: 1.0`,
    `X-Ticket-Id: ${safeTicketId}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join("\r\n");

  const textPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    body,
  ].join("\r\n");

  const pdfPart = [
    `--${boundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: attachment; filename="${filename}"`,
    ``,
    pdfB64,
  ].join("\r\n");

  return (
    headers +
    "\r\n\r\n" +
    textPart +
    "\r\n" +
    pdfPart +
    "\r\n" +
    `--${boundary}--\r\n`
  );
}

export type SendRefundEmailResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; transient: boolean };

/**
 * Lower-level SES send: hand a fully-built raw MIME string and a To-address,
 * we do the SESv2 call and classify the result. Shared by sendRefundEmail
 * (multipart/mixed + PDF attachment) and the sepa-reports R-tx notify path
 * (multipart/alternative, text-only), so both flows go through the same
 * singleton client + transient/permanent error classifier.
 *
 * The caller is responsible for building the MIME with a safe `From`, `To`,
 * `Subject`, and any custom `X-Ticket-Id` / `X-Rtx-*` headers. Payload bytes
 * must already be UTF-8-encodable text (buildMime returns 8bit-safe text
 * even when the body carries ä/ö/ü/ß because SES accepts 8-bit MIME in
 * Content.Raw.Data).
 *
 * `logPrefix` picks the log-key namespace (`ses.send.ok` vs
 * `sepa-reports.notify.send.ok`) so we don't have to grep across
 * unrelated events when triaging.
 */
export async function sendRawMime(input: {
  from: string;
  to: string;
  rawMime: string;
  ticketId: string;
  logPrefix: string;
  extraLogFields?: Record<string, unknown>;
}): Promise<SendRefundEmailResult> {
  const configurationSet = process.env["RAILBACK_SES_CONFIGURATION_SET"];
  const cmdInput: SendEmailCommandInput = {
    FromEmailAddress: input.from,
    Destination: { ToAddresses: [input.to] },
    Content: { Raw: { Data: Buffer.from(input.rawMime, "utf8") } },
    ...(configurationSet !== undefined && configurationSet.length > 0
      ? { ConfigurationSetName: configurationSet }
      : {}),
  };

  try {
    const client = getClient();
    const response = await client.send(new SendEmailCommand(cmdInput));
    const messageId = response.MessageId ?? "";
    log.info(`${input.logPrefix}.ok`, {
      ticketId: input.ticketId,
      messageId,
      ...input.extraLogFields,
    });
    return { ok: true, messageId };
  } catch (err) {
    const e = err as { name?: string; message?: string };
    const name = e.name ?? "UnknownError";
    const message = e.message ?? String(err);
    const transient = isTransientSesError(name);
    log.warn(`${input.logPrefix}.fail`, {
      ticketId: input.ticketId,
      name,
      message,
      transient,
      ...input.extraLogFields,
    });
    return { ok: false, error: `${name}: ${message}`, transient };
  }
}

export async function sendRefundEmail(input: {
  to: string;
  vorname: string;
  nachname: string;
  ticketId: string;
  pdfBytes: Uint8Array;
}): Promise<SendRefundEmailResult> {
  // RAILBACK_SES_FROM_ADDRESS is REQUIRED. A silent fallback (e.g.
  // noreply@example.invalid) would cause every send to fail at SES with
  // MailFromDomainNotVerified — classifying that as permanent would flip
  // every in-flight ticket to terminal EMAIL_FAILED. Hard-fail at first
  // use instead; the handler treats this throw as render/persist-class
  // (5xx, ticket stays in EMAIL_SENDING) so the operator can fix the env
  // var without burning any user's retry budget.
  const from = process.env["RAILBACK_SES_FROM_ADDRESS"];
  if (!from || from.length === 0) {
    throw new AppError(
      "ERR_INTERNAL",
      "RAILBACK_SES_FROM_ADDRESS not set",
    );
  }

  const rawMime = buildMime({
    from,
    to: input.to,
    ticketId: input.ticketId,
    vorname: input.vorname,
    nachname: input.nachname,
    pdfBytes: input.pdfBytes,
  });

  return sendRawMime({
    from,
    to: input.to,
    rawMime,
    ticketId: input.ticketId,
    logPrefix: "ses.send",
  });
}
