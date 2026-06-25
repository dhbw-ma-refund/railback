import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleDeleteTicket } from "../src/routes/delete-ticket.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";
import type { Db } from "@railback/lib/storage/types";
import type { TicketState } from "@railback/lib/types/enums";

const TID = "01HZZA0000000000000000DEL1";

async function seedAliceTicket(
  db: Db,
  ticketId: string,
  state: TicketState = "VALIDATING",
): Promise<void> {
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
  if (state !== "VALIDATING") {
    await db.tickets.patch(ALICE_EMAIL, ticketId, { ticket_state: state });
  }
}

function eventFor(ticketId: string, token?: string) {
  const ev = makeEvent({
    method: "DELETE",
    path: `/users/me/tickets/${ticketId}`,
    ...(token !== undefined ? { token } : {}),
  });
  ev.pathParameters = { ticketId };
  return ev;
}

describe("DELETE /users/me/tickets/{ticketId}", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("soft-deletes a VALIDATING ticket: state INVALID, ttl ~now+90d, returns 204", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID, "VALIDATING");

    const before = Math.floor(Date.now() / 1000);
    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    const after = Math.floor(Date.now() / 1000);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    const t = await db.tickets.get(ALICE_EMAIL, TID);
    expect(t).not.toBeNull();
    expect(t!.ticket_state).toBe("INVALID");
    // 90d = 7_776_000 sec. Allow a small window around the call.
    const ninetyDays = 90 * 24 * 60 * 60;
    expect(t!.ttl).toBeGreaterThanOrEqual(before + ninetyDays - 1);
    expect(t!.ttl).toBeLessThanOrEqual(after + ninetyDays + 1);
    // state_timeline got an INVALID entry appended.
    expect(t!.state_timeline.at(-1)?.state).toBe("INVALID");
  });

  it("is idempotent: a second delete on an INVALID ticket is a no-op 204", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID, "INVALID");
    const before = await db.tickets.get(ALICE_EMAIL, TID);

    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(204);

    // No state-transition appended a second time, no ttl bumped.
    const after = await db.tickets.get(ALICE_EMAIL, TID);
    expect(after!.state_timeline.length).toBe(before!.state_timeline.length);
    expect(after!.ttl).toBe(before!.ttl);
  });

  it("ERR_CONFLICT when the ticket is in a money-flow state (PENDING_DB_PAYMENT)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID, "PENDING_DB_PAYMENT");

    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");

    // Ticket untouched.
    const t = await db.tickets.get(ALICE_EMAIL, TID);
    expect(t!.ticket_state).toBe("PENDING_DB_PAYMENT");
  });

  it("ERR_CONFLICT when the ticket is APPROVED (admin owns terminal money-flow rows)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID, "APPROVED");

    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(409);
  });

  it("ERR_CONFLICT on REJECTED (audit-trail retention, HGB §257)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID, "REJECTED");

    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_CONFLICT");
    expect(body.error.details?.current_state).toBe("REJECTED");
    // Ticket untouched.
    const t = await db.tickets.get(ALICE_EMAIL, TID);
    expect(t!.ticket_state).toBe("REJECTED");
  });

  it("ERR_NOT_FOUND when the ticket does not exist", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handleDeleteTicket(
      eventFor("01HZZA0000000000000000MISSING", aliceAccessToken()),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
  });

  it("ERR_NOT_FOUND when the ticket exists but belongs to another user", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await db.tickets.create({
      email: "bob@example.com",
      ticketId: TID,
      filename: "ticket.pdf",
      s3_key: `raw/bob@example.com/${TID}.pdf`,
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      uploadedAt: "2026-06-10T09:00:00Z",
    });

    const res = await handleDeleteTicket(eventFor(TID, aliceAccessToken()));
    expect(res.statusCode).toBe(404);

    // Bob's ticket is untouched.
    const bobs = await db.tickets.get("bob@example.com", TID);
    expect(bobs!.ticket_state).toBe("VALIDATING");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID);

    const res = await handleDeleteTicket(eventFor(TID));
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN for an ADMIN-role token", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await seedAliceTicket(db, TID);

    const res = await handleDeleteTicket(
      eventFor(TID, adminAccessToken("admin@example.com")),
    );
    expect(res.statusCode).toBe(403);
  });
});
