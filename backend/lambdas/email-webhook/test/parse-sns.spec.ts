// Unit coverage for the pure SNS/SES parsers. Verifies the X-Ticket-Id
// header lookup is case-insensitive, the legacy `notificationType` shape
// is accepted, and the parser is tolerant of malformed inputs.

import { describe, expect, it } from "vitest";

import {
  extractTicketId,
  parseSesEvent,
  type SnsRecord,
} from "../src/parse-sns.js";

function makeRecord(messageBody: unknown): SnsRecord {
  return {
    Sns: {
      Type: "Notification",
      MessageId: "sns-1",
      Message: typeof messageBody === "string" ? messageBody : JSON.stringify(messageBody),
      Timestamp: "2026-06-26T10:00:31Z",
    },
  };
}

describe("parseSesEvent", () => {
  it("parses a Configuration-Set Delivery event with eventType", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        mail: {
          messageId: "ses-1",
          headers: [{ name: "X-Ticket-Id", value: "TKT-1" }],
        },
        delivery: { timestamp: "now", recipients: ["a@b.com"] },
      }),
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("Delivery");
    expect(ev!.mail.messageId).toBe("ses-1");
    expect(ev!.delivery?.recipients).toEqual(["a@b.com"]);
  });

  it("parses a legacy Bounce notification with notificationType", () => {
    const ev = parseSesEvent(
      makeRecord({
        notificationType: "Bounce",
        mail: {
          messageId: "ses-2",
          headers: [{ name: "X-Ticket-Id", value: "TKT-2" }],
        },
        bounce: { bounceType: "Permanent", bounceSubType: "General" },
      }),
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("Bounce");
    expect(ev!.bounce?.bounceSubType).toBe("General");
  });

  it("parses a Complaint event with feedback type", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Complaint",
        mail: {
          messageId: "ses-3",
          headers: [{ name: "X-Ticket-Id", value: "TKT-3" }],
        },
        complaint: { complaintFeedbackType: "abuse" },
      }),
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("Complaint");
    expect(ev!.complaint?.complaintFeedbackType).toBe("abuse");
  });

  it("returns null on malformed JSON", () => {
    const ev = parseSesEvent(makeRecord("not-json"));
    expect(ev).toBeNull();
  });

  it("returns null on an unknown eventType (Send/Open/Click/Reject)", () => {
    for (const t of ["Send", "Reject", "Open", "Click"]) {
      const ev = parseSesEvent(
        makeRecord({ eventType: t, mail: { messageId: "x", headers: [] } }),
      );
      expect(ev).toBeNull();
    }
  });

  it("returns null on missing mail block", () => {
    const ev = parseSesEvent(makeRecord({ eventType: "Delivery" }));
    expect(ev).toBeNull();
  });

  it("returns null on missing Sns.Message", () => {
    const ev = parseSesEvent({ Sns: { Message: "" } });
    expect(ev).toBeNull();
  });

  it("prefers eventType when both eventType and notificationType are present", () => {
    // SES has been known to set both during transitions; eventType is the
    // newer one, so it wins.
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        notificationType: "Bounce",
        mail: { messageId: "ses-x", headers: [] },
      }),
    );
    expect(ev?.type).toBe("Delivery");
  });
});

describe("extractTicketId", () => {
  it("finds X-Ticket-Id with the canonical casing", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        mail: { messageId: "x", headers: [{ name: "X-Ticket-Id", value: "TKT-100" }] },
      }),
    )!;
    expect(extractTicketId(ev)).toBe("TKT-100");
  });

  it("finds the header case-insensitively (x-ticket-id, X-TICKET-ID, x-Ticket-Id)", () => {
    for (const name of ["x-ticket-id", "X-TICKET-ID", "x-Ticket-Id"]) {
      const ev = parseSesEvent(
        makeRecord({
          eventType: "Delivery",
          mail: { messageId: "x", headers: [{ name, value: "TKT-CI" }] },
        }),
      )!;
      expect(extractTicketId(ev)).toBe("TKT-CI");
    }
  });

  it("returns null when the header is missing", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        mail: { messageId: "x", headers: [{ name: "From", value: "noreply@test" }] },
      }),
    )!;
    expect(extractTicketId(ev)).toBeNull();
  });

  it("returns null when the header value is empty/whitespace", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        mail: { messageId: "x", headers: [{ name: "X-Ticket-Id", value: "   " }] },
      }),
    )!;
    expect(extractTicketId(ev)).toBeNull();
  });

  it("returns null when there are no headers at all", () => {
    const ev = parseSesEvent(
      makeRecord({
        eventType: "Delivery",
        mail: { messageId: "x" },
      }),
    )!;
    expect(extractTicketId(ev)).toBeNull();
  });
});
