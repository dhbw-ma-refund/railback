import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
  seedMandate,
  seedTicket,
} from "./fixtures.js";
import { db } from "@railback/lib/storage";
import type { TicketState } from "@railback/lib/types/enums";

const TID = "01HZPAIN008REBUILD000000001";

describe("POST /admin/tickets/{ticketId}/pain008-rebuild", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path: APPROVED + mandate exists + pain008 unbuilt → 200 with pain008_* fields", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticketId).toBe(TID);
    expect(typeof body.mandate_id).toBe("string");
    expect(typeof body.pain008_batch_id).toBe("string");
    expect(typeof body.pain008_built_at).toBe("string");
    expect(body.pain008_s3_key).toMatch(/^pain008\/\d{4}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/);

    // Mandate stamped + XML lives in S3.
    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate!.pain008_built_at).toBe(body.pain008_built_at);
    expect(mandate!.pain008_batch_id).toBe(body.pain008_batch_id);
    expect(mandate!.pain008_s3_key).toBe(body.pain008_s3_key);
    expect(mandate!.mandate_state).toBe("ISSUED");

    const blob = await db().blobs.getBytes(mandate!.pain008_s3_key!);
    expect(blob).not.toBeNull();
    expect(blob!.contentType).toBe("application/xml");
  });

  it("404 when ticket missing", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/01HZUNKNOWNTICKET00000000X/pain008-rebuild`,
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("404 when mandate missing (zero-fee waiver path)", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    // No seedMandate — waiver path.

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  // Every non-APPROVED ticket_state the seed can produce must reject with
  // 409. EMAIL_SENDING etc. are owned by the system, not admin.
  const NON_APPROVED_STATES: ReadonlyArray<TicketState> = [
    "VALIDATING",
    "READY",
    "EMAIL_SENDING",
    "PENDING_DB_PAYMENT",
    "EMAIL_FAILED",
    "COMPLETED",
    "REJECTED",
    "INVALID",
  ];
  for (const state of NON_APPROVED_STATES) {
    it(`409 when ticket_state is ${state}`, async () => {
      const dbi = installTestEnv();
      await seedAdmin();
      await seedAlice(dbi);
      // Build a credible history for each state so the seed-walk doesn't
      // step on a forbidden transition. Terminal states need a full prior
      // path; non-terminal ones use the natural prefix.
      const history: Record<TicketState, ReadonlyArray<TicketState>> = {
        VALIDATING: [],
        READY: [],
        EMAIL_SENDING: ["READY"],
        PENDING_DB_PAYMENT: ["READY", "EMAIL_SENDING"],
        APPROVED: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
        EMAIL_FAILED: ["READY", "EMAIL_SENDING"],
        COMPLETED: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT", "APPROVED"],
        REJECTED: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
        INVALID: [],
      };
      await seedTicket(dbi, ALICE_EMAIL, TID, {
        ticket_state_history: history[state],
        ticket_state: state,
      });
      await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

      const res = await handler(
        makeEvent({
          method: "POST",
          path: `/admin/tickets/${TID}/pain008-rebuild`,
          token: adminAccessToken(),
          body: {},
        }),
      );
      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("ERR_CONFLICT");
      expect(body.error.details.from).toBe(state);
    });
  }

  it("409 when pain008 already built (idempotency guard)", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, {
      fee_amount: "0.75",
      pain008_batch_id: "01HSEEDEDBATCH00000000000",
      pain008_s3_key: "pain008/2026-06/01HSEEDEDBATCH00000000000.xml",
      pain008_built_at: "2026-06-25T09:00:00.000Z",
    });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_CONFLICT");
    expect(body.error.details.pain008_batch_id).toBe("01HSEEDEDBATCH00000000000");
    expect(body.error.details.pain008_built_at).toBe("2026-06-25T09:00:00.000Z");
    expect(body.error.details.pain008_s3_key).toBe(
      "pain008/2026-06/01HSEEDEDBATCH00000000000.xml",
    );

    // Mandate untouched.
    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate!.pain008_batch_id).toBe("01HSEEDEDBATCH00000000000");
  });

  it("500 on pain008-build failure (missing SEPA env); ticket + mandate unchanged", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

    // Break a SEPA env var so buildPain008Xml throws.
    vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", "");

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe("ERR_INTERNAL");

    // Ticket stays APPROVED; mandate not stamped.
    const ticket = await db().tickets.get(ALICE_EMAIL, TID);
    expect(ticket!.ticket_state).toBe("APPROVED");
    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate!.pain008_built_at).toBeUndefined();
    expect(mandate!.pain008_batch_id).toBeUndefined();
    expect(mandate!.pain008_s3_key).toBeUndefined();
  });

  it("accepts an absent body (no `{}`) — empty POST body", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: aliceAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        body: {},
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  // Locked 2026-07-01 per audit finding `pain008-rebuild-body-unvalidated`.
  // Symmetric with markSubmittedRequestSchema — a non-empty body is a
  // client bug and should return ERR_VALIDATION, not silently ignore.
  it("ERR_VALIDATION when body has any field", async () => {
    const res = await handler(
      makeEvent({
        method: "POST",
        path: `/admin/tickets/${TID}/pain008-rebuild`,
        token: adminAccessToken(),
        body: { extra: "should-be-rejected" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });
});
