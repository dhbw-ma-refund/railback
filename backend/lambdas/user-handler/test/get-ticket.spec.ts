import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleGetTicket } from "../src/routes/get-ticket.js";
import {
  ALICE_EMAIL,
  aliceAccessToken,
  adminAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";
import type { Db } from "@railback/lib/storage/types";

const TID = "01HZZA0000000000000000TKT1";

async function seedAliceTicket(db: Db, ticketId = TID): Promise<void> {
  await db.tickets.create({
    email: ALICE_EMAIL,
    ticketId,
    filename: "ticket.pdf",
    s3_key: `raw/${ALICE_EMAIL}/${ticketId}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    uploadedAt: "2026-06-10T09:00:00Z",
  });
  await db.tickets.patch(ALICE_EMAIL, ticketId, {
    fahrt_abreisedatum: "2026-06-10",
    fahrt_abreisebahnhof: "Berlin Hbf",
    fahrt_zielbahnhof: "Hamburg Hbf",
    fahrt_zugnummer_plan: "ICE 123",
    fahrt_fahrkartenpreis: "42.50",
    barcode_uid: "ABCDEF1234567890",
  });
}

function eventFor(ticketId: string, token?: string) {
  const ev = makeEvent({
    method: "GET",
    path: `/users/me/tickets/${ticketId}`,
    ...(token !== undefined ? { token } : {}),
  });
  ev.pathParameters = { ticketId };
  return ev;
}

describe("GET /users/me/tickets/{ticketId}", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the full ticket projection for the owner", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db);

    const res = await handleGetTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      email: ALICE_EMAIL,
      ticketId: TID,
      ticket_state: "VALIDATING",
      extraction_method: "BARCODE",
      fahrt_abreisedatum: "2026-06-10",
      fahrt_zugnummer_plan: "ICE 123",
      fahrt_fahrkartenpreis: "42.50",
      barcode_uid: "ABCDEF1234567890",
    });
    expect(Array.isArray(body.state_timeline)).toBe(true);
    // No internal-only fields leak through.
    expect(body.ttl).toBeUndefined();
    expect(body.archive_ttl).toBeUndefined();
    expect(body.service_fee_state).toBeUndefined();
    expect(body.email_provider_id).toBeUndefined();
  });

  it("works when only the raw path is set (no pathParameters from dispatcher)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db);

    const ev = makeEvent({
      method: "GET",
      path: `/users/me/tickets/${TID}`,
      token: aliceAccessToken(),
    });
    // No pathParameters — relies on the route's regex fallback.
    const res = await handleGetTicket(ev);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ticketId).toBe(TID);
  });

  it("ERR_NOT_FOUND when the ticket does not exist", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handleGetTicket(
      eventFor("01HZZA0000000000000000NONE1", aliceAccessToken()),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("ERR_NOT_FOUND when the ticket exists but belongs to someone else", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    // Same ticketId, but registered under bob@example.com.
    await db.tickets.create({
      email: "bob@example.com",
      ticketId: TID,
      filename: "ticket.pdf",
      s3_key: `raw/bob@example.com/${TID}.pdf`,
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 512,
      uploadedAt: "2026-06-10T09:00:00Z",
    });

    const res = await handleGetTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handleGetTicket(eventFor(TID));
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN for an ADMIN-role token", async () => {
    const res = await handleGetTicket(
      eventFor(TID, adminAccessToken("admin@example.com")),
    );
    expect(res.statusCode).toBe(403);
  });
});
