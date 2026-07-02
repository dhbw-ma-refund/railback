import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
  seedTicket,
} from "./fixtures.js";

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
});
