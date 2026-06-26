// Pure SNS-envelope + SES-event-payload parsers. No DB access here.
//
// SES Configuration Set Event Destinations publish JSON-stringified
// payloads to SNS. Lambda's SNS trigger wraps them in the standard
// `Records[].Sns.Message` envelope. We accept both the "Configuration-Set"
// shape (`eventType`) and the older direct-from-SES shape
// (`notificationType`) — they overlap structurally except for that one
// discriminator field.
//
// All functions are pure + null-tolerant; the caller logs and 200s on null.

export interface SnsRecord {
  Sns: {
    Type?: string;
    MessageId?: string;
    Message: string;
    Timestamp?: string;
    Subject?: string;
  };
}

export interface SnsEvent {
  Records: SnsRecord[];
}

export type SesEventType = "Delivery" | "Bounce" | "Complaint";

export interface SesEventMailHeader {
  name: string;
  value: string;
}

export interface SesEventMail {
  messageId?: string;
  timestamp?: string;
  source?: string;
  destination?: string[];
  headers?: SesEventMailHeader[];
}

export interface SesEvent {
  /** Normalised to one of the three states we care about. */
  type: SesEventType;
  mail: SesEventMail;
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: { emailAddress: string; diagnosticCode?: string }[];
  };
  complaint?: {
    complainedRecipients?: { emailAddress: string }[];
    complaintFeedbackType?: string;
  };
  delivery?: {
    timestamp?: string;
    recipients?: string[];
  };
}

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(["Delivery", "Bounce", "Complaint"]);

/**
 * Parse one SNS record into a normalised SES event. Returns null for:
 *   - missing/invalid `Sns.Message` JSON
 *   - unknown / unsupported event types (Send, Reject, Open, Click, etc.)
 *   - missing `mail` block
 *
 * Caller logs + skips on null; SNS never retries since the handler 200s.
 */
export function parseSesEvent(record: SnsRecord): SesEvent | null {
  const raw = record?.Sns?.Message;
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  // Configuration-Set Event Destinations use `eventType`; legacy direct-SES
  // notifications use `notificationType`. Prefer the newer one.
  const rawType = typeof obj["eventType"] === "string"
    ? (obj["eventType"] as string)
    : typeof obj["notificationType"] === "string"
      ? (obj["notificationType"] as string)
      : null;
  if (rawType === null || !SUPPORTED_TYPES.has(rawType)) return null;

  const mail = obj["mail"];
  if (!mail || typeof mail !== "object") return null;

  const event: SesEvent = {
    type: rawType as SesEventType,
    mail: normaliseMail(mail as Record<string, unknown>),
  };
  if (obj["bounce"] && typeof obj["bounce"] === "object") {
    event.bounce = obj["bounce"] as NonNullable<SesEvent["bounce"]>;
  }
  if (obj["complaint"] && typeof obj["complaint"] === "object") {
    event.complaint = obj["complaint"] as NonNullable<SesEvent["complaint"]>;
  }
  if (obj["delivery"] && typeof obj["delivery"] === "object") {
    event.delivery = obj["delivery"] as NonNullable<SesEvent["delivery"]>;
  }
  return event;
}

function normaliseMail(raw: Record<string, unknown>): SesEventMail {
  const mail: SesEventMail = {};
  if (typeof raw["messageId"] === "string") mail.messageId = raw["messageId"];
  if (typeof raw["timestamp"] === "string") mail.timestamp = raw["timestamp"];
  if (typeof raw["source"] === "string") mail.source = raw["source"];
  if (Array.isArray(raw["destination"])) {
    mail.destination = (raw["destination"] as unknown[]).filter(
      (d): d is string => typeof d === "string",
    );
  }
  if (Array.isArray(raw["headers"])) {
    const headers: SesEventMailHeader[] = [];
    for (const h of raw["headers"] as unknown[]) {
      if (h && typeof h === "object") {
        const hr = h as Record<string, unknown>;
        if (typeof hr["name"] === "string" && typeof hr["value"] === "string") {
          headers.push({ name: hr["name"], value: hr["value"] });
        }
      }
    }
    mail.headers = headers;
  }
  return mail;
}

/**
 * Case-insensitive lookup of the `X-Ticket-Id` header on the SES `mail.headers`
 * array. Returns null when missing or empty. Mail clients / forwarders are free
 * to re-case custom headers (`X-Ticket-ID`, `x-ticket-id`) so we normalise both
 * sides.
 */
export function extractTicketId(event: SesEvent): string | null {
  const headers = event.mail.headers;
  if (!headers) return null;
  for (const h of headers) {
    if (h.name.toLowerCase() === "x-ticket-id") {
      const v = h.value.trim();
      return v.length > 0 ? v : null;
    }
  }
  return null;
}
