// email-webhook entrypoint — Lambda subscribed to an SNS topic that the
// SES Configuration-Set Event Destination publishes Delivery/Bounce/Complaint
// events to.
//
// Wire shape (verbatim from AWS docs):
//   { Records: [{ Sns: { Type, MessageId, Message: "<json string>", ... } }, ...] }
//
// The Sns.Message is a JSON-encoded SES event with `eventType` (Configuration
// Set destinations) or `notificationType` (legacy direct-subscribe), plus a
// `mail` block carrying the message-id, destination, and custom headers. We
// match by the custom `X-Ticket-Id` header (set in @railback/lib/email's MIME
// builder) — the SES message-id is per-attempt and not useful as a primary key.
//
// Per-record contract:
//   1. Parse the SES event. Unrecognised eventType / missing mail / bad JSON →
//      log warn + continue. SNS never retries (we always return ok).
//   2. Read X-Ticket-Id; missing → log warn + continue.
//   3. Look up the (ticketId → email) mapping via TicketOwnerRepo (single
//      DDB GetItem per record); missing → log warn + continue. Anonymisation
//      may have deleted the mapping row alongside the parent ticket row.
//   4. Load the ticket; missing → log warn + continue.
//   5. Dispatch to the matching route handler.
//
// Per-record failure model:
//   - Payload-invalid (bad JSON, unknown eventType, missing X-Ticket-Id,
//     missing TicketOwner row, missing UserTicket row) is signalled by
//     return-null sentinels from the parse/lookup helpers. Those paths
//     log + drop the record; the handler proceeds.
//   - Storage failures (DDB throttle, network, validation) thrown from
//     repos or route patches PROPAGATE: handler rejects → Lambda fails →
//     SNS retries the batch → eventually DLQ. We must NOT swallow these,
//     or SES events get silently lost while the ticket sits in
//     EMAIL_SENDING until the 24h watchdog fires webhook_timeout.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";

import { extractTicketId, parseSesEvent, type SnsEvent } from "./parse-sns.js";
import { onDelivered } from "./routes/delivered.js";
import { onBounced } from "./routes/bounced.js";
import { onComplained } from "./routes/complained.js";

export async function handler(event: SnsEvent): Promise<{ ok: true }> {
  const records = event?.Records ?? [];
  for (const record of records) {
    // Storage errors propagate (see header). Payload-invalid paths inside
    // processOne return early via logged null-sentinels.
    await processOne(record);
  }
  return { ok: true };
}

async function processOne(record: unknown): Promise<void> {
  const rec = record as Parameters<typeof parseSesEvent>[0];
  const parsed = parseSesEvent(rec);
  if (parsed === null) {
    log.warn("webhook.parse.unrecognised", {
      snsMessageId: rec?.Sns?.MessageId,
    });
    return;
  }

  const ticketId = extractTicketId(parsed);
  if (ticketId === null) {
    log.warn("webhook.parse.no_ticket_id", {
      sesMessageId: parsed.mail.messageId,
      type: parsed.type,
    });
    return;
  }

  const owner = await db().ticketOwners.get(ticketId);
  if (owner === null) {
    log.warn("webhook.unknown_ticket", { ticketId, type: parsed.type });
    return;
  }

  const ticket = await db().tickets.get(owner.email, ticketId);
  if (ticket === null) {
    // TicketOwner row exists but the parent ticket is gone. Anonymisation
    // window or partial cascade. Drop.
    log.warn("webhook.ticket_row_missing", { ticketId, type: parsed.type });
    return;
  }

  if (parsed.type === "Delivery") {
    await onDelivered({ ticket });
  } else if (parsed.type === "Bounce") {
    const bouncedArgs: { ticket: typeof ticket; bounceSubType?: string } = { ticket };
    if (parsed.bounce?.bounceSubType !== undefined) {
      bouncedArgs.bounceSubType = parsed.bounce.bounceSubType;
    }
    await onBounced(bouncedArgs);
  } else {
    const complainedArgs: { ticket: typeof ticket; feedbackType?: string } = { ticket };
    if (parsed.complaint?.complaintFeedbackType !== undefined) {
      complainedArgs.feedbackType = parsed.complaint.complaintFeedbackType;
    }
    await onComplained(complainedArgs);
  }
}
