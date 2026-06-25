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

describe("GET /admin/tickets", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("lists all tickets, joins vorname/nachname", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZTICKETS000000000000A1", {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "PENDING_DB_PAYMENT",
      fahrt_abreisedatum: "2026-05-12",
      fahrt_abreisebahnhof: "Mannheim Hbf",
      fahrt_zielbahnhof: "Karlsruhe Hbf",
      fahrt_zugnummer_plan: "IC 2345",
      antragsart: "ENTSCHAEDIGUNG_60_119",
      antragsgrund: ["VERSPAETUNG"],
      erwartete_erstattung: "29.90",
      delayMinutes: 65,
    });

    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/tickets", token: adminAccessToken() }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    const t = body.items[0];
    expect(t.ticketId).toBe("01HZTICKETS000000000000A1");
    expect(t.vorname).toBe("Alice");
    expect(t.abreisedatum).toBe("2026-05-12");
    expect(t.zugnummer_plan).toBe("IC 2345");
    expect(t.delayMinutes).toBe(65);
    expect(JSON.stringify(body)).not.toMatch(/iban|bic/i);
  });

  it("filters by state (review queue = PENDING_DB_PAYMENT)", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, "01HZTICKETS000000000000B1", {
      ticket_state: "READY",
    });
    await seedTicket(db, ALICE_EMAIL, "01HZTICKETS000000000000B2", {
      ticket_state_history: ["READY", "EMAIL_SENDING"],
      ticket_state: "PENDING_DB_PAYMENT",
    });

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/tickets",
        token: adminAccessToken(),
        queryStringParameters: { state: "PENDING_DB_PAYMENT" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].ticketId).toBe("01HZTICKETS000000000000B2");
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/admin/tickets", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(makeEvent({ method: "GET", path: "/admin/tickets" }));
    expect(res.statusCode).toBe(401);
  });
});
