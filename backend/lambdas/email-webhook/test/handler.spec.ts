// Handler-level integration tests — covers the dispatch logic, the
// failure-path branches (missing header, unknown ticketId, malformed JSON),
// the multi-record envelope, and the never-throw contract.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handler } from "../src/handler.js";
import { db } from "@railback/lib/storage";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  ALICE_EMAIL,
  buildRawSnsEvent,
  buildSnsEvent,
  seedTicketInState,
} from "./fixtures.js";
import type { SnsEvent } from "../src/parse-sns.js";

describe("email-webhook handler", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("dispatches a Delivery event to the delivered route", async () => {
    const { email, ticketId } = await seedTicketInState();
    const result = await handler(buildSnsEvent({ type: "Delivery", ticketId }));
    expect(result).toEqual({ ok: true });
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
  });

  it("dispatches a Bounce event to the bounced route", async () => {
    const { email, ticketId } = await seedTicketInState();
    await handler(buildSnsEvent({ type: "Bounce", ticketId }));
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.email_failed_reason).toBe("bounced");
  });

  it("dispatches a Complaint event to the complained route", async () => {
    const { email, ticketId } = await seedTicketInState();
    await handler(buildSnsEvent({ type: "Complaint", ticketId }));
    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("complained");
  });

  it("unknown eventType (Send/Open/Click/Reject) is silently dropped — no state change, no throw", async () => {
    const { email, ticketId } = await seedTicketInState();
    const before = await db().tickets.get(email, ticketId);
    // Craft an SNS envelope with a Send eventType (the parser drops it).
    const ev: SnsEvent = {
      Records: [
        {
          Sns: {
            Type: "Notification",
            MessageId: "sns-unknown",
            Message: JSON.stringify({
              eventType: "Send",
              mail: { messageId: "x", headers: [{ name: "X-Ticket-Id", value: ticketId }] },
            }),
          },
        },
      ],
    };
    const result = await handler(ev);
    expect(result).toEqual({ ok: true });
    const after = await db().tickets.get(email, ticketId);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("missing X-Ticket-Id → log warn, return ok, no state change", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { email, ticketId } = await seedTicketInState();
    const before = await db().tickets.get(email, ticketId);

    const result = await handler(buildSnsEvent({ type: "Delivery", noTicketIdHeader: true, ticketId: "ignored" }));

    expect(result).toEqual({ ok: true });
    const after = await db().tickets.get(email, ticketId);
    expect(after!.updated_at).toBe(before!.updated_at);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("unknown ticketId (no TicketOwner row) → log warn, return ok, no throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await handler(buildSnsEvent({ type: "Delivery", ticketId: "TKT-NONEXISTENT" }));
    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("orphan TicketOwner row (parent ticket missing) → log warn, return ok", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Owner row exists, but the ticket row was never created.
    await db().ticketOwners.put("TKT-ORPHAN", ALICE_EMAIL);
    const result = await handler(buildSnsEvent({ type: "Delivery", ticketId: "TKT-ORPHAN" }));
    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("malformed JSON in Sns.Message → log warn, return ok, no throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await handler(buildRawSnsEvent("this is not json{"));
    expect(result).toEqual({ ok: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("multi-record envelope: one malformed + one valid — the valid one still processes", async () => {
    const { email, ticketId } = await seedTicketInState();
    const valid = buildSnsEvent({ type: "Delivery", ticketId });
    const merged: SnsEvent = {
      Records: [
        // Malformed
        {
          Sns: {
            Type: "Notification",
            MessageId: "sns-bad",
            Message: "{ this is not valid json",
          },
        },
        // The valid Delivery record.
        ...valid.Records,
      ],
    };

    const result = await handler(merged);
    expect(result).toEqual({ ok: true });
    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
  });

  it("legacy notificationType envelope shape works the same as eventType", async () => {
    const { email, ticketId } = await seedTicketInState();

    await handler(buildSnsEvent({ type: "Bounce", ticketId, legacy: true }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("BOUNCED");
  });

  it("storage failure: patch() rejects → handler propagates the error (SNS retries, then DLQ)", async () => {
    // Storage errors (DDB throttle, network, validation) must not be swallowed.
    // If we returned ok here, the SES event would be silently lost and the
    // ticket would sit in EMAIL_SENDING until the 24h watchdog kicks
    // webhook_timeout. SNS retries are the correct recovery channel.
    const { ticketId } = await seedTicketInState();

    const repo = db().tickets;
    const original = repo.patch.bind(repo);
    repo.patch = (async () => {
      throw new Error("simulated DDB outage");
    }) as typeof repo.patch;

    try {
      await expect(handler(buildSnsEvent({ type: "Delivery", ticketId }))).rejects.toThrow(
        "simulated DDB outage",
      );
    } finally {
      repo.patch = original;
    }
  });

  it("payload-invalid records DO NOT propagate even after the patch-throw policy change", async () => {
    // Sibling test to the storage-propagation case. Missing X-Ticket-Id is a
    // payload bug, not a storage bug — it has to be swallowed (SNS retries
    // can't fix a broken header). Demonstrates the two error classes are
    // distinguishable end-to-end.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { email, ticketId } = await seedTicketInState();
    const before = await db().tickets.get(email, ticketId);

    const result = await handler(
      buildSnsEvent({ type: "Delivery", noTicketIdHeader: true, ticketId: "ignored" }),
    );

    expect(result).toEqual({ ok: true });
    const after = await db().tickets.get(email, ticketId);
    expect(after!.updated_at).toBe(before!.updated_at);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("empty Records array → ok, no work done", async () => {
    const result = await handler({ Records: [] });
    expect(result).toEqual({ ok: true });
  });

  it("case-insensitive X-Ticket-Id lookup matches header re-casing by mail clients", async () => {
    const { email, ticketId } = await seedTicketInState();

    await handler(buildSnsEvent({ type: "Delivery", ticketId, headerName: "x-ticket-id" }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_status).toBe("DELIVERED");
  });

  it("event with missing Records key → ok, no work done", async () => {
    // Defensive: the per-record loop guards `event?.Records ?? []`. A Lambda
    // runtime is unlikely to deliver `{}` but defensive code without a
    // defensive test is risky.
    const result = await handler({} as SnsEvent);
    expect(result).toEqual({ ok: true });
  });

  it("undefined event → ok, no work done", async () => {
    const result = await handler(undefined as unknown as SnsEvent);
    expect(result).toEqual({ ok: true });
  });
});
