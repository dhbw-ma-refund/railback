import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostBelegeConfirm } from "../src/routes/post-belege-confirm.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

async function seedReadyTicket(db: ReturnType<typeof installTestEnv>): Promise<string> {
  const ticketId = ulid();
  await db.tickets.createFromRoute({
    email: ALICE_EMAIL,
    ticketId,
    trainNr: "ICE 123",
    date: "2026-06-01",
    fromStation: "Berlin Hbf",
    fromEva: 8011160,
    toStation: "München Hbf",
    toEva: 8000261,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "12:00",
    fahrkartennummer: "X1",
    fahrkartenpreis: "100.00",
    is_zeitkarte: false,
  });
  return ticketId;
}

describe("POST /users/me/tickets/{ticketId}/belege/{belegId}/confirm", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("persists the receipt row and bumps belege_count", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = ulid();

    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 12345,
          amount: "42.50",
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).belegId).toBe(belegId);

    const list = await db.blobs.listReceipts(ALICE_EMAIL, ticketId);
    expect(list).toHaveLength(1);
    expect(list[0]?.belegId).toBe(belegId);
    expect(list[0]?.amount).toBe("42.50");
    const ticket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(ticket?.belege_count).toBe(1);
  });

  it("idempotent retry does NOT double-bump belege_count", async () => {
    // Locked by 2026-07-01 audit finding `beleg-confirm-count-drift`:
    // without the pre-existence check in the handler a re-POST would
    // overwrite the RECEIPT# row (same PK/SK) AND bump belege_count
    // again, so N retries could push the count past the 5-cap without
    // any new belege being added. Sends the same confirm three times
    // and asserts one receipt + count=1.
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = ulid();
    const body = {
      s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
      filename: "taxi.pdf",
      mimeType: "application/pdf",
      typ: "TAXI",
      size_bytes: 12345,
      amount: "42.50",
    };
    const evt = makeEvent({
      method: "POST",
      path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
      token: aliceAccessToken(),
      body,
      pathParameters: { ticketId, belegId },
    });

    const res1 = await handlePostBelegeConfirm(evt);
    const res2 = await handlePostBelegeConfirm(evt);
    const res3 = await handlePostBelegeConfirm(evt);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res3.statusCode).toBe(200);
    expect(JSON.parse(res2.body).belegId).toBe(belegId);

    const list = await db.blobs.listReceipts(ALICE_EMAIL, ticketId);
    expect(list).toHaveLength(1);
    const ticket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(ticket?.belege_count).toBe(1);
  });

  it("ERR_CONFLICT when ticket already submitted", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    await db.tickets.patch(ALICE_EMAIL, ticketId, { ticket_state: "EMAIL_SENDING" });
    const belegId = ulid();

    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 12345,
          amount: "10.00",
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("404 ERR_NOT_FOUND when ticket doesn't exist", async () => {
    installTestEnv();
    const ticketId = ulid();
    const belegId = ulid();
    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 12345,
          amount: "10.00",
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("ERR_VALIDATION when size_bytes is missing", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = ulid();

    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          amount: "10.00",
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_VALIDATION when amount is missing", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = ulid();

    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 12345,
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_FORBIDDEN for ADMIN tokens", async () => {
    installTestEnv();
    const ticketId = ulid();
    const belegId = ulid();
    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}/confirm`,
        token: adminAccessToken("admin@railback.local"),
        body: {
          s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
          filename: "x.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 100,
          amount: "10.00",
        },
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_VALIDATION when belegId in s3_key doesn't match URL belegId", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const urlBelegId = ulid();
    const keyBelegId = ulid();

    const res = await handlePostBelegeConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege/${urlBelegId}/confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `belege/h/${ticketId}/${keyBelegId}.pdf`,
          filename: "taxi.pdf",
          mimeType: "application/pdf",
          typ: "TAXI",
          size_bytes: 12345,
          amount: "10.00",
        },
        pathParameters: { ticketId, belegId: urlBelegId },
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.details?.field).toBe("s3_key");
    const list = await db.blobs.listReceipts(ALICE_EMAIL, ticketId);
    expect(list).toHaveLength(0);
  });
});
