import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import { getStatsSnapshot, resetStatsCache } from "../src/stats-cache.js";
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

  // Regression: this_month_paid_out must compare instants in UTC, not
  // strings. A `db_paid_at` with a Berlin offset (`+02:00`) at 01:30
  // local on the first day of a UTC month is actually the LAST day of
  // the previous UTC month at 23:30 — string compare would put it in
  // the current month and inflate the KPI. Locked 2026-07-01 per audit
  // finding `stats-lexicographic-datetime-compare`.
  it("compares db_paid_at as an instant, not lexicographically, across UTC-month boundaries", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    // Fixed now: 2026-07-15 UTC — this UTC month starts at 2026-07-01T00:00Z.
    const now = new Date("2026-07-15T12:00:00.000Z");

    // Paid at 2026-07-01T01:30:00+02:00 == 2026-06-30T23:30:00Z (LAST month).
    // Lex-compare against monthStart `2026-07-01T00:00:00.000Z` would treat
    // it as ">=" and count it — instant compare correctly excludes it.
    await seedTicket(db, ALICE_EMAIL, "01HZSTATS0000000000000030", {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
      erwartete_erstattung: "10.00",
      db_paid_at: "2026-07-01T01:30:00+02:00",
    });
    // Paid at 2026-07-15T09:30:00+02:00 == 2026-07-15T07:30:00Z (THIS month).
    await seedTicket(db, ALICE_EMAIL, "01HZSTATS0000000000000031", {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT", "APPROVED"],
      ticket_state: "COMPLETED",
      erwartete_erstattung: "5.00",
      db_paid_at: "2026-07-15T09:30:00+02:00",
    });

    resetStatsCache();
    const snap = await getStatsSnapshot(now);
    expect(snap.refunds.total_paid_out).toBe("15.00");
    expect(snap.refunds.this_month_paid_out).toBe("5.00");
  });
});
