import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
  seedAdmin,
  seedTicket,
} from "./fixtures.js";

describe("GET /admin/stats", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the snapshot shape", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZSTATS0000000000000001", {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
      erwartete_erstattung: "29.90",
    });

    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.users.total).toBe(1);
    expect(body.users.active).toBe(1);
    expect(body.tickets.total).toBe(1);
    expect(body.tickets.by_state.COMPLETED).toBe(1);
    expect(body.refunds.currency).toBe("EUR");
    expect(body.refunds.total_paid_out).toBe("29.90");
    expect(typeof body.as_of).toBe("string");
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ERR_FORBIDDEN");
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(makeEvent({ method: "GET", path: "/admin/stats" }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("caches the snapshot for 30 s — second call does not re-scan tickets", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZSTATS0000000000000010");

    const spy = vi.spyOn(db.tickets, "adminList");

    const a = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: adminAccessToken() }),
    );
    const callsAfterFirst = spy.mock.calls.length;
    const b = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: adminAccessToken() }),
    );
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    spy.mockRestore();
  });

  // Regression: this_month_paid_out must anchor on db_paid_at only — a
  // COMPLETED ticket without db_paid_at must not leak into the current
  // month via submitted_at fallback.
  it("does not count COMPLETED tickets without db_paid_at toward this_month_paid_out", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZSTATS0000000000000020", {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
      erwartete_erstattung: "29.90",
      // explicitly no db_paid_at
    });

    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/stats", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.refunds.total_paid_out).toBe("29.90");
    expect(body.refunds.this_month_paid_out).toBe("0.00");
  });
});
