// Shared fixtures for email-webhook tests.
//
// Seeds a user + ticket pair in the configurable (ticket_state, email_status)
// combo we want to drive a webhook event against, plus the matching
// TicketOwner mapping row (which is what the webhook handler keys off of).
//
// Also exports a helper for building real-shaped SNS event envelopes.

import { db } from "@railback/lib/storage";
import { hashPassword } from "@railback/lib/auth/password";
import { ulid } from "@railback/lib/util/ulid";
import type { EmailStatus, TicketState } from "@railback/lib/types/enums";

import type { SesEventType, SnsEvent } from "../src/parse-sns.js";

export const ALICE_EMAIL = "alice@example.com";
export const ALICE_PASSWORD = "swordfish-secret";

export interface SeedOptions {
  ticket_state?: TicketState;
  email_status?: EmailStatus;
  /** When true, skip writing the TicketOwner mapping row (orphan case). */
  noOwner?: boolean;
  /** When true, skip writing the ticket row (parent missing case). */
  noTicket?: boolean;
}

export interface SeededTicket {
  email: string;
  ticketId: string;
}

/**
 * Seed a user + ticket in the requested email_state combo, plus matching
 * TicketOwner mapping row. Default: EMAIL_SENDING + SENT (what the
 * webhook normally sees on a Delivery event).
 */
export async function seedTicketInState(opts: SeedOptions = {}): Promise<SeededTicket> {
  const ticketId = ulid();
  const hashed_password = await hashPassword(ALICE_PASSWORD);
  await db().users.create({
    email: ALICE_EMAIL,
    vorname: "Alice",
    nachname: "Mueller",
    telefon: "+49 151 1234567",
    adresse: {
      strasse: "Marktplatz",
      hausnr: "5",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
    },
    hashed_password,
    iban_enc: "",
    bic_enc: "",
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });

  const now = new Date().toISOString();
  if (!opts.noTicket) {
    await db().tickets.createFromRoute({
      email: ALICE_EMAIL,
      ticketId,
      trainNr: "ICE100",
      date: "2026-06-01",
      fromStation: "Berlin Hbf",
      fromEva: 8011160,
      toStation: "Frankfurt (Main) Hbf",
      toEva: 8000105,
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "12:00",
      fahrkartennummer: "1234567890",
      fahrkartenpreis: "100.00",
      is_zeitkarte: false,
    });

    await db().tickets.patch(ALICE_EMAIL, ticketId, {
      ticket_state: opts.ticket_state ?? "EMAIL_SENDING",
      antragsart: "ENTSCHAEDIGUNG_120_PLUS",
      antragsgrund: ["VERSPAETUNG"],
      erwartete_erstattung: "50.00",
      service_fee_betrag: "0.75",
      delayMinutes: 130,
      submitted_at: now,
      email_status: opts.email_status ?? "SENT",
      email_attempts: 1,
      email_last_attempt: now,
      email_provider_id: "ses-msg-seeded",
    });
  }

  if (!opts.noOwner) {
    await db().ticketOwners.put(ticketId, ALICE_EMAIL);
  }

  return { email: ALICE_EMAIL, ticketId };
}

export interface BuildSnsOptions {
  type: SesEventType;
  ticketId?: string | null;
  messageId?: string;
  /** Override header name to test case-insensitive lookup. */
  headerName?: string;
  /** Skip adding the X-Ticket-Id header. */
  noTicketIdHeader?: boolean;
  /** Use the legacy `notificationType` discriminator instead of `eventType`. */
  legacy?: boolean;
  bounceSubType?: string;
  complaintFeedbackType?: string;
}

/**
 * Build a real-shape SNS event with one record carrying an SES notification.
 * Used as the input to the handler.
 */
export function buildSnsEvent(opts: BuildSnsOptions): SnsEvent {
  const messageId = opts.messageId ?? "ses-msg-" + (opts.ticketId ?? "unknown");
  const headers: { name: string; value: string }[] = [];
  if (!opts.noTicketIdHeader && opts.ticketId !== null && opts.ticketId !== undefined) {
    headers.push({ name: opts.headerName ?? "X-Ticket-Id", value: opts.ticketId });
  }
  const body: Record<string, unknown> = {
    mail: {
      messageId,
      timestamp: "2026-06-26T10:00:00Z",
      source: "noreply@railback.test",
      destination: [ALICE_EMAIL],
      headers,
    },
  };
  if (opts.legacy) {
    body["notificationType"] = opts.type;
  } else {
    body["eventType"] = opts.type;
  }
  if (opts.type === "Delivery") {
    body["delivery"] = {
      timestamp: "2026-06-26T10:00:30Z",
      recipients: [ALICE_EMAIL],
    };
  } else if (opts.type === "Bounce") {
    body["bounce"] = {
      bounceType: "Permanent",
      bounceSubType: opts.bounceSubType ?? "General",
      bouncedRecipients: [{ emailAddress: ALICE_EMAIL, diagnosticCode: "550 user unknown" }],
      timestamp: "2026-06-26T10:00:30Z",
    };
  } else {
    body["complaint"] = {
      complainedRecipients: [{ emailAddress: ALICE_EMAIL }],
      complaintFeedbackType: opts.complaintFeedbackType ?? "abuse",
      timestamp: "2026-06-26T10:00:30Z",
    };
  }
  return {
    Records: [
      {
        Sns: {
          Type: "Notification",
          MessageId: "sns-" + messageId,
          Message: JSON.stringify(body),
          Timestamp: "2026-06-26T10:00:31Z",
        },
      },
    ],
  };
}

/** Build a raw SNS event with a custom Message body (for malformed tests). */
export function buildRawSnsEvent(message: string, snsMessageId = "sns-raw"): SnsEvent {
  return {
    Records: [
      {
        Sns: {
          Type: "Notification",
          MessageId: snsMessageId,
          Message: message,
          Timestamp: "2026-06-26T10:00:31Z",
        },
      },
    ],
  };
}
