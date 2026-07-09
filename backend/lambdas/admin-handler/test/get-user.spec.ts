import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  ALICE_IBAN,
  ALICE_BIC,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
  seedTicket,
} from "./fixtures.js";

describe("GET /admin/users/{email}", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the user detail with recent_tickets (max 10)", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    // 12 tickets — recent_tickets should be capped at 10.
    for (let i = 0; i < 12; i++) {
      const id = `01HZUSER0000000000000000${String(i).padStart(2, "0")}`;
      await seedTicket(db, ALICE_EMAIL, id);
    }

    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBe(ALICE_EMAIL);
    expect(body.recent_tickets.length).toBe(10);
    expect(body.ticket_count).toBe(12);
    // Reversed 2026-07-07: admin sees plaintext iban/bic on the user detail view.
    expect(body.iban).toBe(ALICE_IBAN);
    expect(body.bic).toBe(ALICE_BIC);
  });

  it("ERR_NOT_FOUND for unknown email", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/users/nobody@example.com",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("URL-decodes the email in the path", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "GET",
        // %40 = @
        path: `/admin/users/alice%40example.com`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.email).toBe(ALICE_EMAIL);
  });
});
