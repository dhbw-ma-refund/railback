import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostFromRoute } from "../src/routes/post-from-route.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

const DATE = "2026-06-20";

function validBody(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    trainNr: "ICE 1001",
    date: DATE,
    fromStation: "Berlin Hauptbahnhof",
    toStation: "München Hbf",
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "12:00",
    fahrkartennummer: "DB-123-456",
    fahrkartenpreis: "123.45",
    is_zeitkarte: false,
    ...overrides,
  };
}

describe("POST /users/me/tickets/from-route", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("creates a READY ticket with MANUAL_ROUTE extraction and an owner row", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as {
      ticketId: string;
      ticket_state: string;
      extraction_method: string;
      extraction_confidence: number;
    };
    expect(body.ticket_state).toBe("READY");
    expect(body.extraction_method).toBe("MANUAL_ROUTE");
    expect(body.extraction_confidence).toBe(0);
    expect(body.ticketId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Persisted ticket carries the canonical (Hbf-aliased) station names.
    const t = await dbi.tickets.get(ALICE_EMAIL, body.ticketId);
    expect(t).not.toBeNull();
    expect(t!.fahrt_abreisebahnhof).toBe("Berlin Hauptbahnhof");
    expect(t!.fahrt_zielbahnhof).toBe("München Hbf");
    expect(t!.fahrt_fahrkartenpreis).toBe("123.45");
    expect(t!.extraction_method).toBe("MANUAL_ROUTE");
    expect(t!.is_zeitkarte).toBe(false);

    // Owner-mapping row is written.
    const owner = await dbi.ticketOwners.get(body.ticketId);
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe(ALICE_EMAIL);
  });

  it("honours a caller-supplied ticketId", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    const tid = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({ ticketId: tid }),
      }),
    );
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).ticketId).toBe(tid);
    expect(await dbi.tickets.get(ALICE_EMAIL, tid)).not.toBeNull();
  });

  it("ERR_CONFLICT when the same ticketId is submitted twice", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    const tid = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

    const first = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({ ticketId: tid }),
      }),
    );
    expect(first.statusCode).toBe(201);

    const second = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({ ticketId: tid }),
      }),
    );
    expect(second.statusCode).toBe(409);
    const body = JSON.parse(second.body);
    expect(body.error.code).toBe("ERR_CONFLICT");
    expect(body.error.details.existing_ticket_id).toBe(tid);
  });

  it("persists is_zeitkarte=true and a templateId reference", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({
          is_zeitkarte: true,
          templateId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        }),
      }),
    );
    expect(res.statusCode).toBe(201);
    const tid = JSON.parse(res.body).ticketId as string;
    const t = await dbi.tickets.get(ALICE_EMAIL, tid);
    expect(t!.is_zeitkarte).toBe(true);
  });

  it("ERR_VALIDATION on an unresolvable toStation", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({ toStation: "Mordor Hbf" }),
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.details.field).toBe("toStation");
  });

  it("ERR_VALIDATION on a malformed price", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);

    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: aliceAccessToken(),
        body: validBody({ fahrkartenpreis: "123,45 EUR" }),
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN for ADMIN tokens", async () => {
    const dbi = installTestEnv();
    await seedAlice(dbi);
    const res = await handlePostFromRoute(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/from-route",
        token: adminAccessToken("admin@railback.de"),
        body: validBody(),
      }),
    );
    expect(res.statusCode).toBe(403);
  });
});
