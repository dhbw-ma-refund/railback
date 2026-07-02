import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostBelege } from "../src/routes/post-belege.js";
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

describe("POST /users/me/tickets/{ticketId}/belege", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("issues a presigned POST for a beleg upload", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);

    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: aliceAccessToken(),
        body: { filename: "taxi.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.belegId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.s3_key).toContain(ticketId);
    expect(body.s3_key).toContain(body.belegId);
    expect(body.fields["Content-Type"]).toBe("application/pdf");
  });

  it("ERR_CONFLICT when ticket is past READY (already submitted)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    await db.tickets.patch(ALICE_EMAIL, ticketId, { ticket_state: "EMAIL_SENDING" });

    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: aliceAccessToken(),
        body: { filename: "x.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
  });

  it("ERR_CONFLICT when 5 belege already exist", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    for (let i = 0; i < 5; i++) {
      await db.blobs.putReceipt(ALICE_EMAIL, ticketId, {
        belegId: ulid(),
        filename: `b${i}.pdf`,
        s3_bucket: "memory-mock",
        s3_key: `belege/h/${ticketId}/b${i}.pdf`,
        content_type: "application/pdf",
        size_bytes: 1000,
        typ: "TAXI",
        amount: "10.00",
        uploaded_at: new Date().toISOString(),
      });
    }

    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: aliceAccessToken(),
        body: { filename: "x.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("404 ERR_NOT_FOUND when ticket doesn't exist", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: aliceAccessToken(),
        body: { filename: "x.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("ERR_VALIDATION on bad mimeType", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: aliceAccessToken(),
        body: { filename: "x.zip", mimeType: "application/zip", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_FORBIDDEN for ADMIN tokens", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        token: adminAccessToken("admin@railback.local"),
        body: { filename: "x.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostBelege(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/belege`,
        body: { filename: "x.pdf", mimeType: "application/pdf", typ: "TAXI" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
