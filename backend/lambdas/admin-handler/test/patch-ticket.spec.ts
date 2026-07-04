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

const TID = "01HZPATCHTICKET00000000001";

describe("PATCH /admin/tickets/{ticketId}", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("flips PENDING_DB_PAYMENT → APPROVED and stamps db_paid_at", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED", db_paid_at: "2026-06-25T09:30:00+02:00" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket_state).toBe("APPROVED");
    expect(body.db_paid_at).toBe("2026-06-25T09:30:00+02:00");
  });

  it("ERR_CONFLICT for disallowed transition COMPLETED → APPROVED", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
  });

  it("rejects forbidden fields (.strict)", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { erwartete_erstattung: "0.01" },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("accepts db_paid_at correction without a state change", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
      db_paid_at: "2026-06-25T09:00:00+02:00",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { db_paid_at: "2026-06-25T10:00:00+02:00", admin_note: "korrigiert" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.db_paid_at).toBe("2026-06-25T10:00:00+02:00");
    expect(body.admin_note).toBe("korrigiert");
    expect(body.ticket_state).toBe("APPROVED");
  });

  it("→ REJECTED stamps ttl = now + 90d (DB_SCHEMA §DSGVO rows 986-987)", async () => {
    // Locked by 2026-07-01 audit finding `missing-ttl-on-terminal-
    // transitions`. Without this stamp REJECTED rows would never expire
    // in DDB even though nothing personenbezogen needs to survive.
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });

    const before = Math.floor(Date.now() / 1000);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "REJECTED", admin_note: "beleg unlesbar" },
      }),
    );
    const after = Math.floor(Date.now() / 1000);
    expect(res.statusCode).toBe(200);
    const row = await db.tickets.get(ALICE_EMAIL, TID);
    expect(row?.ticket_state).toBe("REJECTED");
    expect(row?.ttl).toBeGreaterThanOrEqual(before + 90 * 24 * 60 * 60);
    expect(row?.ttl).toBeLessThanOrEqual(after + 90 * 24 * 60 * 60);
  });

  it("→ INVALID stamps ttl = now + 90d", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY"],
      ticket_state: "VALIDATING",
    });

    const before = Math.floor(Date.now() / 1000);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "INVALID", admin_note: "bad ticket" },
      }),
    );
    const after = Math.floor(Date.now() / 1000);
    expect(res.statusCode).toBe(200);
    const row = await db.tickets.get(ALICE_EMAIL, TID);
    expect(row?.ticket_state).toBe("INVALID");
    expect(row?.ttl).toBeGreaterThanOrEqual(before + 90 * 24 * 60 * 60);
    expect(row?.ttl).toBeLessThanOrEqual(after + 90 * 24 * 60 * 60);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: aliceAccessToken(),
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  // --- Phase 2.9 pain008-generator wiring ---------------------------------

  it("* → APPROVED with mandate present: invokes pain008-generator, stamps mandate", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED", db_paid_at: "2026-06-25T09:30:00+02:00" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket_state).toBe("APPROVED");

    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate).not.toBeNull();
    expect(mandate!.pain008_built_at).toBeDefined();
    expect(mandate!.pain008_batch_id).toBeDefined();
    expect(mandate!.pain008_s3_key).toMatch(/^pain008\/\d{4}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/);
    // Mandate stays in ISSUED — mark-submitted is a separate admin call.
    expect(mandate!.mandate_state).toBe("ISSUED");

    const blob = await db().blobs.getBytes(mandate!.pain008_s3_key!);
    expect(blob).not.toBeNull();
    expect(blob!.contentType).toBe("application/xml");
  });

  it("APPROVED → APPROVED (no state change): does NOT re-invoke pain008-generator", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "PENDING_DB_PAYMENT"],
      ticket_state: "APPROVED",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, {
      fee_amount: "0.75",
      pain008_batch_id: "01HSEEDEDPRIORBATCHID0000",
      pain008_s3_key: "pain008/2026-06/01HSEEDEDPRIORBATCHID0000.xml",
      pain008_built_at: "2026-06-25T09:00:00.000Z",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { db_paid_at: "2026-06-25T10:00:00+02:00" },
      }),
    );
    expect(res.statusCode).toBe(200);

    // Mandate's pain008_* fields unchanged.
    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate!.pain008_batch_id).toBe("01HSEEDEDPRIORBATCHID0000");
    expect(mandate!.pain008_built_at).toBe("2026-06-25T09:00:00.000Z");
  });

  it("* → APPROVED without mandate (zero-fee waiver): no invoke, no error", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });
    // No seedMandate call — zero-fee waiver path.

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket_state).toBe("APPROVED");

    expect(await db().mandates.get(ALICE_EMAIL, TID)).toBeNull();
  });

  it("* → APPROVED when mandate.pain008_built_at already set: no rebuild", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, {
      fee_amount: "0.75",
      pain008_batch_id: "01HSEEDEDOLDBATCH00000000",
      pain008_s3_key: "pain008/2026-06/01HSEEDEDOLDBATCH00000000.xml",
      pain008_built_at: "2026-06-20T09:00:00.000Z",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(200);

    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    // Unchanged — pre-check kicked in before the invoke.
    expect(mandate!.pain008_batch_id).toBe("01HSEEDEDOLDBATCH00000000");
    expect(mandate!.pain008_built_at).toBe("2026-06-20T09:00:00.000Z");
  });

  it("pain008-generator failure (missing SEPA env) → 500, ticket stays APPROVED", async () => {
    const dbi = installTestEnv();
    await seedAdmin();
    await seedAlice(dbi);
    await seedTicket(dbi, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });
    await seedMandate(dbi, ALICE_EMAIL, TID, { fee_amount: "0.75" });

    // Break a SEPA env var so buildPain008Xml throws ERR_INTERNAL.
    vi.stubEnv("RAILBACK_SEPA_GLAEUBIGER_ID", "");

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED" },
      }),
    );
    expect(res.statusCode).toBe(500);

    // Ticket state DID land — patch committed before the invoke.
    const ticket = await db().tickets.get(ALICE_EMAIL, TID);
    expect(ticket!.ticket_state).toBe("APPROVED");
    // Mandate NOT stamped — invoke failed.
    const mandate = await db().mandates.get(ALICE_EMAIL, TID);
    expect(mandate!.pain008_built_at).toBeUndefined();
  });
});
