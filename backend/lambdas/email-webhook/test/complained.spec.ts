// Route-level tests for Complaint handling.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../src/handler.js";
import { db } from "@railback/lib/storage";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { buildSnsEvent, seedTicketInState } from "./fixtures.js";

describe("onComplained route", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("EMAIL_SENDING+SENT → EMAIL_FAILED+BOUNCED+reason=complained", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_SENDING",
      email_status: "SENT",
    });

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.email_failed_reason).toBe("complained");
  });

  it("idempotent on already EMAIL_FAILED+reason=complained (event re-delivery)", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "BOUNCED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "complained" });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.updated_at).toBe(before!.updated_at);
    expect(after!.email_failed_reason).toBe("complained");
  });

  it("late complaint after Delivery is no-op when ticket reached PENDING_DB_PAYMENT", async () => {
    // Admin owns review from PENDING_DB_PAYMENT onward. A late spam-flag does
    // not retroactively un-send the PDF; reverting would destroy in-flight
    // admin work. See routes/complained.ts header.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "PENDING_DB_PAYMENT",
      email_status: "DELIVERED",
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Complaint", ticketId, complaintFeedbackType: "abuse" }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  // Out-of-window matrix: terminal admin-owned + pre-send states must never
  // be rewritten by a late Complaint event.
  it.each([
    ["APPROVED", "DELIVERED"],
    ["COMPLETED", "DELIVERED"],
    ["REJECTED", "DELIVERED"],
    ["INVALID", "FAILED_TRANSIENT"],
    ["READY", "FAILED_TRANSIENT"],
    ["VALIDATING", "FAILED_TRANSIENT"],
  ] as const)("late Complaint on ticket_state=%s is no-op", async (ticket_state, email_status) => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state,
      email_status,
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe(ticket_state);
    expect(after!.email_status).toBe(email_status);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("upgrades EMAIL_FAILED+FAILED+reason=max_retries → BOUNCED+reason=complained (precedence)", async () => {
    // DB_SCHEMA.md:413: complained > max_retries. A late Complaint should
    // upgrade the catch-all terminal to the spam-feedback-loop signal.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "max_retries" });

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("complained");
    expect(after!.email_status).toBe("BOUNCED");
  });

  it("upgrades EMAIL_FAILED+FAILED+reason=webhook_timeout → BOUNCED+reason=complained (precedence)", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "webhook_timeout" });

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("complained");
  });

  it("does NOT downgrade EMAIL_FAILED+BOUNCED+reason=bounced (bounce > complained)", async () => {
    // DB_SCHEMA.md:413: bounced > complained. A prior Bounce terminal is more
    // specific than a follow-up Complaint and must stay put.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "BOUNCED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "bounced" });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Complaint", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("bounced");
    expect(after!.updated_at).toBe(before!.updated_at);
  });
});
