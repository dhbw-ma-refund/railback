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
  seedMandate,
  seedTicket,
} from "./fixtures.js";

const TID = "01HZTICKETDETAIL000000000A";

describe("GET /admin/tickets/{ticketId}", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the full ticket detail + sepa_mandate block", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, {
      ticket_state_history: ["READY", "EMAIL_SENDING", "PENDING_DB_PAYMENT"],
      ticket_state: "PENDING_DB_PAYMENT",
      fahrt_abreisedatum: "2026-05-12",
      fahrt_zugnummer_plan: "IC 2345",
      erwartete_erstattung: "29.90",
      service_fee_betrag: "0.75",
    });
    await seedMandate(db, ALICE_EMAIL, TID);

    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticketId).toBe(TID);
    expect(body.email).toBe(ALICE_EMAIL);
    expect(body.vorname).toBe("Alice");
    expect(body.fahrt_abreisedatum).toBe("2026-05-12");
    expect(body.has_belege).toBe(false);
    expect(body.sepa_mandate.state).toBe("ISSUED");
    expect(body.service_fee_betrag).toBe("0.75");
    expect(JSON.stringify(body)).not.toMatch(/iban|bic/i);
  });

  it("omits sepa_mandate when no mandate exists yet", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await seedTicket(db, ALICE_EMAIL, TID, { ticket_state: "READY" });

    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/tickets/${TID}`,
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.sepa_mandate).toBeUndefined();
  });

  it("ERR_NOT_FOUND for unknown ticketId (no owner row)", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/admin/tickets/01HZNOTFOUND00000000000000",
        token: adminAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: `/admin/tickets/${TID}`,
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: `/admin/tickets/${TID}` }),
    );
    expect(res.statusCode).toBe(401);
  });
});
