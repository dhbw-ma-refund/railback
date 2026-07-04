// Cross-lambda email pipeline flow spec.
//
// Exercises the full path: user-handler POST /refund → refund-pdf.renderAndSend
// (SES send) → email-sweeper (retry + watchdog passes) → email-webhook
// (Delivery / Bounce → terminal states). Each `it` calls installTestEnv()
// in-line for a fresh MemState so cases don't leak.
//
// The Python ticket-extractor is out-of-process — every seed here simulates
// its persist step by using db.tickets.createFromRoute() (which lands the
// ticket in READY with extraction_method=MANUAL_ROUTE). That's sufficient
// for the /refund → email flow; no barcode-uid / PDF-text extraction is
// needed on the happy path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ulid } from "@railback/lib/util/ulid";
import type { Db } from "@railback/lib/storage/types";
import type { RefundRequest } from "@railback/lib/schemas/ticket";
import { _setSesClient } from "@railback/refund-pdf/send-email";

import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";
import { handler as emailWebhookHandler, type SnsEvent } from "@railback/email-webhook";
import { handler as emailSweeperHandler } from "@railback/email-sweeper";

// parse-sns's SesEventType isn't re-exported from the webhook barrel; keep
// it as a local literal union so we don't reach into src/*.
type SesEventType = "Delivery" | "Bounce" | "Complaint";

import { installTestEnv, teardownTestEnv } from "../shared/env.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "../shared/fixtures.js";

const TRAIN_NR = "ICE 707";
const DATE = "2026-06-25";

// --- Helpers -----------------------------------------------------------

function refundBody(overrides: Partial<RefundRequest> = {}): RefundRequest {
  return {
    antragsgrund: ["VERSPAETUNG"],
    antragsart: "ENTSCHAEDIGUNG_60_119",
    fahrt: {
      abreisedatum: DATE,
      abreisebahnhof: "Berlin Hauptbahnhof",
      zielbahnhof: "München Hbf",
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "14:00",
      zugnummer_plan: TRAIN_NR,
      fahrkartennummer: "DB-42",
      fahrkartenpreis: "100.00",
    },
    fahrt_tatsaechlich: {
      ankunftsdatum_tatsaechlich: DATE,
      ankunftszeit_tatsaechlich: "15:30",
      zugnummer_tatsaechlich: TRAIN_NR,
    },
    antragstellung_ort: "Berlin",
    datenschutz_einwilligung: true,
    wahrheitserklaerung: true,
    ...overrides,
  };
}

// Real extractor runs in Python; this simulates its persist step by landing
// a READY ticket via the same route-template path the MANUAL_ROUTE flow uses.
// The TicketOwner mapping row is also written here — the real
// POST /users/me/tickets/from-route route writes it via TransactWriteItems,
// but calling db.tickets.createFromRoute() directly bypasses that seam, so
// the webhook path (which keys off TicketOwner) can't resolve without it.
async function seedReadyTicket(db: Db, opts: { withDelay?: number } = {}): Promise<string> {
  const ticketId = ulid();
  await db.tickets.createFromRoute({
    email: ALICE_EMAIL,
    ticketId,
    trainNr: TRAIN_NR,
    date: DATE,
    fromStation: "Berlin Hauptbahnhof",
    fromEva: 8011160,
    toStation: "München Hbf",
    toEva: 8000261,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "14:00",
    fahrkartennummer: "DB-42",
    fahrkartenpreis: "100.00",
    is_zeitkarte: false,
  });
  await db.ticketOwners.put(ticketId, ALICE_EMAIL);
  if (opts.withDelay !== undefined) {
    await db.tickets.patch(ALICE_EMAIL, ticketId, { delayMinutes: opts.withDelay });
  }
  return ticketId;
}

// Build an Error the SES send path classifies as transient — see
// lib/src/email/send-email.ts::TRANSIENT_ERROR_NAMES. A bare `new Error(...)`
// has `name = "Error"` which is permanent, and would flip email_status
// straight to FAILED (skipping the retry queue entirely).
function transientSesError(msg = "transient blip"): Error {
  const e: Error & { name?: string } = new Error(msg);
  e.name = "ThrottlingException";
  return e;
}

async function postRefund(ticketId: string): Promise<{ statusCode: number; body: string }> {
  return userHandler(
    makeEvent({
      method: "POST",
      path: `/users/me/tickets/${ticketId}/refund`,
      token: aliceAccessToken(),
      pathParameters: { ticketId },
      body: refundBody(),
    }),
  );
}

// Local SNS event builder — mirrors lambdas/email-webhook/test/fixtures.ts.
// Re-implemented here so this flow spec doesn't import into a lambda's test
// tree. Uses the legacy `notificationType` discriminator (both are accepted
// by parse-sns.ts).
interface BuildSnsOpts {
  type: SesEventType;
  ticketId: string;
  messageId?: string;
  bounceType?: string;
  bounceSubType?: string;
}
function buildSnsEvent(opts: BuildSnsOpts): SnsEvent {
  const messageId = opts.messageId ?? `ses-msg-${opts.ticketId}`;
  const body: Record<string, unknown> = {
    notificationType: opts.type,
    mail: {
      messageId,
      timestamp: "2026-06-26T10:00:00Z",
      source: "noreply@railback.test",
      destination: [ALICE_EMAIL],
      headers: [{ name: "X-Ticket-Id", value: opts.ticketId }],
    },
  };
  if (opts.type === "Delivery") {
    body["delivery"] = {
      timestamp: "2026-06-26T10:00:30Z",
      recipients: [ALICE_EMAIL],
    };
  } else if (opts.type === "Bounce") {
    body["bounce"] = {
      bounceType: opts.bounceType ?? "Permanent",
      bounceSubType: opts.bounceSubType ?? "General",
      bouncedRecipients: [
        { emailAddress: ALICE_EMAIL, diagnosticCode: "550 user unknown" },
      ],
      timestamp: "2026-06-26T10:00:30Z",
    };
  } else {
    body["complaint"] = {
      complainedRecipients: [{ emailAddress: ALICE_EMAIL }],
      complaintFeedbackType: "abuse",
      timestamp: "2026-06-26T10:00:30Z",
    };
  }
  return {
    Records: [
      {
        Sns: {
          Type: "Notification",
          MessageId: `sns-${messageId}`,
          Message: JSON.stringify(body),
          Timestamp: "2026-06-26T10:00:31Z",
        },
      },
    ],
  };
}

// --- Specs -------------------------------------------------------------

describe("email pipeline flow", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path: /refund → SES 2xx → SENT, Delivery webhook → PENDING_DB_PAYMENT+DELIVERED", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await postRefund(ticketId);
    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.email_status).toBe("SENT");
    expect(body.ticket_state).toBe("EMAIL_SENDING");

    const t1 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t1?.email_status).toBe("SENT");
    // Default SES mock returns MessageId="test-integration" — captured on the ticket.
    expect(typeof t1?.email_provider_id).toBe("string");

    await emailWebhookHandler(buildSnsEvent({ type: "Delivery", ticketId }));

    const t2 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t2?.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(t2?.email_status).toBe("DELIVERED");
  });

  it("retry path: first SES send fails transient, sweeper resends and lands SENT", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    // Override the shared SES mock: attempt 1 throws (transient), attempt 2 succeeds.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient({
      send: vi
        .fn()
        .mockRejectedValueOnce(transientSesError())
        .mockResolvedValue({ MessageId: "retry-msg" }),
    } as any);

    const res = await postRefund(ticketId);
    expect(res.statusCode).toBe(202);

    const afterAttempt1 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(afterAttempt1?.email_status).toBe("FAILED_TRANSIENT");
    expect(afterAttempt1?.email_attempts).toBe(1);
    expect(afterAttempt1?.ticket_state).toBe("EMAIL_SENDING");

    const sweep = await emailSweeperHandler();
    expect(sweep.retried).toBeGreaterThanOrEqual(1);

    const afterAttempt2 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(afterAttempt2?.email_status).toBe("SENT");
    expect(afterAttempt2?.email_attempts).toBe(2);
    expect(afterAttempt2?.email_provider_id).toBe("retry-msg");
  });

  it("max-retries: SES rejects 3× → ticket_state=EMAIL_FAILED, email_status=FAILED, reason=max_retries", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _setSesClient({
      send: vi.fn().mockRejectedValue(transientSesError()),
    } as any);

    // Attempt 1 — inline in refund-pdf via user-handler.
    const res = await postRefund(ticketId);
    expect(res.statusCode).toBe(202);
    const t1 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t1?.email_status).toBe("FAILED_TRANSIENT");
    expect(t1?.email_attempts).toBe(1);

    // Attempts 2 + 3 — sweeper.
    await emailSweeperHandler();
    const t2 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t2?.email_attempts).toBe(2);
    expect(t2?.email_status).toBe("FAILED_TRANSIENT");

    await emailSweeperHandler();
    const t3 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t3?.email_attempts).toBe(3);
    expect(t3?.email_status).toBe("FAILED");
    expect(t3?.ticket_state).toBe("EMAIL_FAILED");
    expect(t3?.email_failed_reason).toBe("max_retries");
  });

  it("webhook Bounce: SENT → EMAIL_FAILED+BOUNCED+reason=bounced", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await postRefund(ticketId);
    expect(res.statusCode).toBe(202);
    const t1 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t1?.email_status).toBe("SENT");

    await emailWebhookHandler(
      buildSnsEvent({ type: "Bounce", ticketId, bounceType: "Permanent" }),
    );

    const t2 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t2?.ticket_state).toBe("EMAIL_FAILED");
    expect(t2?.email_status).toBe("BOUNCED");
    expect(t2?.email_failed_reason).toBe("bounced");
  });

  it("webhook Complaint: SENT → EMAIL_FAILED+BOUNCED+reason=complained", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const res = await postRefund(ticketId);
    expect(res.statusCode).toBe(202);
    const t1 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t1?.email_status).toBe("SENT");

    // ARCHITECTURE.md: EmailStatus enum has no dedicated COMPLAINED —
    // complaint reuses BOUNCED and disambiguates via email_failed_reason.
    await emailWebhookHandler(buildSnsEvent({ type: "Complaint", ticketId }));

    const t2 = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t2?.ticket_state).toBe("EMAIL_FAILED");
    expect(t2?.email_status).toBe("BOUNCED");
    expect(t2?.email_failed_reason).toBe("complained");
  });

  it("watchdog: EMAIL_SENDING+SENT with email_last_attempt backdated 25h → EMAIL_FAILED+webhook_timeout", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db, { withDelay: 90 });

    const backdated = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await db.tickets.patch(ALICE_EMAIL, ticketId, {
      ticket_state: "EMAIL_SENDING",
      antragsart: "ENTSCHAEDIGUNG_60_119",
      antragsgrund: ["VERSPAETUNG"],
      erwartete_erstattung: "25.00",
      service_fee_betrag: "0.75",
      submitted_at: backdated,
      email_status: "SENT",
      email_attempts: 1,
      email_last_attempt: backdated,
      email_provider_id: "ses-stuck-" + ticketId,
    });
    // Owner mapping row is already written by seedReadyTicket above; kept
    // here as an explicit no-op reference for the watchdog contract.

    const sweep = await emailSweeperHandler();
    // Exactly one seeded ticket in this fresh MemState — the count is
    // deterministic. A permissive lower-bound would let unrelated stuck
    // rows satisfy this assertion in a shared-state regression.
    expect(sweep.watchdog_timeouts).toBe(1);

    const after = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(after?.ticket_state).toBe("EMAIL_FAILED");
    expect(after?.email_failed_reason).toBe("webhook_timeout");
  });
});
