import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  ALICE_IBAN,
  ALICE_BIC,
  BOB_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
  seedBob,
  seedTicket,
} from "./fixtures.js";

describe("GET /admin/users", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("lists all users (no filter) with derived ticket_count + total_refunded", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedBob(db);
    await seedTicket(db, ALICE_EMAIL, "01HZUSERS000000000000A001", {
      ticket_state_history: ["READY", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
      erwartete_erstattung: "29.90",
    });

    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/users", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(2);
    const alice = body.items.find((u: { email: string }) => u.email === ALICE_EMAIL);
    expect(alice.ticket_count).toBe(1);
    expect(alice.total_refunded).toBe("29.90");
    // Reversed 2026-07-07: admin sees plaintext iban/bic on the user view.
    expect(alice.iban).toBe(ALICE_IBAN);
    expect(alice.bic).toBe(ALICE_BIC);
  });

  it("filters by email prefix", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedBob(db);

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/users",
        token: adminAccessToken(),
        queryStringParameters: { email: "ali" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].email).toBe(ALICE_EMAIL);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/users", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(makeEvent({ method: "GET", path: "/admin/users" }));
    expect(res.statusCode).toBe(401);
  });

  it("ERR_VALIDATION for limit > 100", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/users",
        token: adminAccessToken(),
        queryStringParameters: { limit: "500" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("filters by user_state", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedBob(db);
    // Suspend Bob via the repo directly (avoids invoking the patch route).
    await db.users.updateProfile(BOB_EMAIL, {
      user_state: "SUSPENDED",
      suspended_at: new Date().toISOString(),
      suspended_reason: "test",
    });

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/users",
        token: adminAccessToken(),
        queryStringParameters: { user_state: "SUSPENDED" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].email).toBe(BOB_EMAIL);
  });
});
