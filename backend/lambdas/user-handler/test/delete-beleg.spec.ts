import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleDeleteBeleg } from "../src/routes/delete-beleg.js";
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

async function seedBeleg(
  db: ReturnType<typeof installTestEnv>,
  ticketId: string,
): Promise<string> {
  const belegId = ulid();
  await db.blobs.putReceipt(ALICE_EMAIL, ticketId, {
    belegId,
    filename: "taxi.pdf",
    s3_bucket: "memory-mock",
    s3_key: `belege/h/${ticketId}/${belegId}.pdf`,
    content_type: "application/pdf",
    size_bytes: 1234,
    typ: "TAXI",
    amount: "15.00",
    uploaded_at: new Date().toISOString(),
  });
  return belegId;
}

describe("DELETE /users/me/tickets/{ticketId}/belege/{belegId}", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("removes the beleg and decrements belege_count", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = await seedBeleg(db, ticketId);
    await db.tickets.patch(ALICE_EMAIL, ticketId, { belege_count: 1 });

    const res = await handleDeleteBeleg(
      makeEvent({
        method: "DELETE",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(204);

    const list = await db.blobs.listReceipts(ALICE_EMAIL, ticketId);
    expect(list).toHaveLength(0);
    const ticket = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(ticket?.belege_count).toBe(0);
  });

  it("ERR_CONFLICT when ticket already submitted", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = await seedBeleg(db, ticketId);
    await db.tickets.patch(ALICE_EMAIL, ticketId, { ticket_state: "EMAIL_SENDING" });

    const res = await handleDeleteBeleg(
      makeEvent({
        method: "DELETE",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(409);
  });

  it("404 ERR_NOT_FOUND when beleg does not exist", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = await seedReadyTicket(db);
    const belegId = ulid();

    const res = await handleDeleteBeleg(
      makeEvent({
        method: "DELETE",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("404 ERR_NOT_FOUND when ticket does not exist", async () => {
    installTestEnv();
    const ticketId = ulid();
    const belegId = ulid();
    const res = await handleDeleteBeleg(
      makeEvent({
        method: "DELETE",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("ERR_FORBIDDEN for ADMIN tokens", async () => {
    installTestEnv();
    const ticketId = ulid();
    const belegId = ulid();
    const res = await handleDeleteBeleg(
      makeEvent({
        method: "DELETE",
        path: `/users/me/tickets/${ticketId}/belege/${belegId}`,
        token: adminAccessToken("admin@railback.local"),
        pathParameters: { ticketId, belegId },
      }),
    );
    expect(res.statusCode).toBe(403);
  });
});
