// Route-level tests for Delivery handling. Verifies the happy-path
// transition, the noop on already-DELIVERED, and the out-of-order
// drop on a Delivery arriving after EMAIL_FAILED.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../src/handler.js";
import { db } from "@railback/lib/storage";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { buildSnsEvent, seedTicketInState } from "./fixtures.js";

describe("onDelivered route", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("EMAIL_SENDING+SENT → PENDING_DB_PAYMENT+DELIVERED", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_SENDING",
      email_status: "SENT",
    });

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after).not.toBeNull();
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
    expect(after!.email_failed_reason).toBeUndefined();
  });

  it("idempotent — already PENDING_DB_PAYMENT+DELIVERED stays put", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "PENDING_DB_PAYMENT",
      email_status: "DELIVERED",
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
    // updated_at should not have advanced (no patch fired).
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("out-of-order: terminal EMAIL_FAILED ticket is NOT resurrected by a late Delivery", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
    });

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("FAILED");
  });

  it("out-of-order: Delivery on a READY ticket is dropped", async () => {
    // Pathological: webhook arrives for a ticket that's been rolled back to
    // READY by the render-fail path. Drop silently.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "READY",
      email_status: "FAILED_TRANSIENT",
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("READY");
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("out-of-order: Delivery after EMAIL_FAILED+BOUNCED stays terminal+BOUNCED (no resurrection)", async () => {
    // Realistic out-of-order: a Bounce fired first (and was processed), then
    // a retransmitted Delivery event arrives. The terminal Bounce wins.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "BOUNCED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "bounced" });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.email_failed_reason).toBe("bounced");
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("out-of-order: late Delivery on ticket_state=APPROVED is no-op (defensive)", async () => {
    // Symmetric to the bounced/complained out-of-window tests. The delivered
    // route already gates on EMAIL_SENDING; this is a regression-test to keep
    // it that way. A late Delivery must not re-stamp PENDING_DB_PAYMENT once
    // admin has already advanced the ticket past it.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "APPROVED",
      email_status: "DELIVERED",
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Delivery", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("APPROVED");
    expect(after!.email_status).toBe("DELIVERED");
    expect(after!.updated_at).toBe(before!.updated_at);
  });
});
