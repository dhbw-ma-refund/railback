// Route-level tests for Bounce handling.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handler } from "../src/handler.js";
import { db } from "@railback/lib/storage";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import { buildSnsEvent, seedTicketInState } from "./fixtures.js";

describe("onBounced route", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("EMAIL_SENDING+SENT → EMAIL_FAILED+BOUNCED+reason=bounced", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_SENDING",
      email_status: "SENT",
    });

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.email_failed_reason).toBe("bounced");
  });

  it("idempotent on already EMAIL_FAILED+BOUNCED+reason=bounced (event re-delivery)", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "BOUNCED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "bounced" });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.updated_at).toBe(before!.updated_at);
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.email_failed_reason).toBe("bounced");
  });

  it("upgrades EMAIL_FAILED+FAILED+reason=max_retries → BOUNCED+reason=bounced (precedence)", async () => {
    // DB_SCHEMA.md:413: bounced > max_retries. A late Bounce after the sweeper
    // already gave up should overwrite the catch-all terminal with the
    // definitive recipient-MX answer.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "max_retries" });

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("bounced");
    expect(after!.email_status).toBe("BOUNCED");
    expect(after!.ticket_state).toBe("EMAIL_FAILED");
  });

  it("upgrades EMAIL_FAILED+FAILED+reason=webhook_timeout → BOUNCED+reason=bounced (precedence)", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "FAILED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "webhook_timeout" });

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("bounced");
    expect(after!.email_status).toBe("BOUNCED");
  });

  it("upgrades EMAIL_FAILED+BOUNCED+reason=complained → BOUNCED+reason=bounced (precedence)", async () => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_FAILED",
      email_status: "BOUNCED",
    });
    await db().tickets.patch(email, ticketId, { email_failed_reason: "complained" });

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.email_failed_reason).toBe("bounced");
  });

  it("late bounce after Delivery is no-op when ticket reached PENDING_DB_PAYMENT", async () => {
    // Admin owns review from PENDING_DB_PAYMENT onward. A late bounce on the
    // user's inbox does not retroactively un-send the PDF; reverting would
    // destroy in-flight admin work. See routes/bounced.ts header.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "PENDING_DB_PAYMENT",
      email_status: "DELIVERED",
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Bounce", ticketId, bounceSubType: "MailboxFull" }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(after!.email_status).toBe("DELIVERED");
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  // Out-of-window matrix: terminal admin-owned + pre-send states must never
  // be rewritten by a late Bounce event. Parametrised so a future state-machine
  // addition shows up here.
  it.each([
    ["APPROVED", "DELIVERED"],
    ["COMPLETED", "DELIVERED"],
    ["REJECTED", "DELIVERED"],
    ["INVALID", "FAILED_TRANSIENT"],
    ["READY", "FAILED_TRANSIENT"],
    ["VALIDATING", "FAILED_TRANSIENT"],
  ] as const)("late Bounce on ticket_state=%s is no-op", async (ticket_state, email_status) => {
    const { email, ticketId } = await seedTicketInState({
      ticket_state,
      email_status,
    });
    const before = await db().tickets.get(email, ticketId);

    await handler(buildSnsEvent({ type: "Bounce", ticketId }));

    const after = await db().tickets.get(email, ticketId);
    expect(after!.ticket_state).toBe(ticket_state);
    expect(after!.email_status).toBe(email_status);
    expect(after!.updated_at).toBe(before!.updated_at);
  });

  it("bounceSubType is logged-only, NOT persisted as a ticket attribute", async () => {
    // ARCHITECTURE.md / DB_SCHEMA.md have no `bounce_subtype` column. The
    // subtype lives in CloudWatch logs only; any future patch that
    // accidentally writes it onto the ticket should be caught by this test.
    const { email, ticketId } = await seedTicketInState({
      ticket_state: "EMAIL_SENDING",
      email_status: "SENT",
    });

    await handler(buildSnsEvent({ type: "Bounce", ticketId, bounceSubType: "MailboxFull" }));

    const after = await db().tickets.get(email, ticketId);
    expect((after as unknown as Record<string, unknown>)["bounce_subtype"]).toBeUndefined();
    expect((after as unknown as Record<string, unknown>)["bounceSubType"]).toBeUndefined();
  });
});
