import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handleGetTickets } from "../src/routes/get-tickets.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";
import type { Db } from "@railback/lib/storage/types";

async function seedTicket(
  db: Db,
  email: string,
  ticketId: string,
  updatedAt: string,
  overrides: Partial<{
    ticket_state: "VALIDATING" | "READY" | "INVALID";
    fahrt_abreisebahnhof: string;
    fahrt_zielbahnhof: string;
    fahrt_zugnummer_plan: string;
    fahrt_abreisedatum: string;
    erwartete_erstattung: string;
  }> = {},
): Promise<void> {
  await db.tickets.create({
    email,
    ticketId,
    filename: "ticket.pdf",
    s3_key: `raw/${email}/${ticketId}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    uploadedAt: updatedAt,
  });
  // patch() inside the in-memory repo rewrites updated_at to "now". When
  // three back-to-back seedTicket calls land in the same millisecond the
  // sort by updated_at is non-deterministic. A 5ms wait between patches
  // is enough to spread the timestamps.
  await new Promise((r) => setTimeout(r, 5));
  await db.tickets.patch(email, ticketId, overrides);
}

describe("GET /users/me/tickets", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns an empty list when caller has no tickets", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handleGetTickets(
      makeEvent({ method: "GET", path: "/users/me/tickets", token: aliceAccessToken() }),
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ items: [] });
  });

  it("returns owned tickets sorted by updated_at desc, projected to summary fields", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    // Three tickets with deliberately out-of-order updated_at.
    await seedTicket(db, ALICE_EMAIL, "01HZZA00000000000000000001", "2026-06-01T10:00:00Z", {
      fahrt_abreisebahnhof: "Berlin Hbf",
      fahrt_zielbahnhof: "Hamburg Hbf",
      fahrt_zugnummer_plan: "ICE 123",
      fahrt_abreisedatum: "2026-06-01",
      erwartete_erstattung: "15.00",
    });
    await seedTicket(db, ALICE_EMAIL, "01HZZA00000000000000000002", "2026-06-03T10:00:00Z");
    await seedTicket(db, ALICE_EMAIL, "01HZZA00000000000000000003", "2026-06-02T10:00:00Z");

    const res = await handleGetTickets(
      makeEvent({ method: "GET", path: "/users/me/tickets", token: aliceAccessToken() }),
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toHaveLength(3);
    // After the patch() each row's updated_at was reset to "now"; the
    // patch order was 1 → 2 → 3, so the desc order should be 3, 2, 1.
    expect(body.items.map((x: { ticketId: string }) => x.ticketId)).toEqual([
      "01HZZA00000000000000000003",
      "01HZZA00000000000000000002",
      "01HZZA00000000000000000001",
    ]);

    // The third (last) item carries the populated trip fields under the
    // contract-flat names (no fahrt_ prefix); the desc-order put it last.
    const last = body.items[2];
    expect(last.ticketId).toBe("01HZZA00000000000000000001");
    expect(last.abreisebahnhof).toBe("Berlin Hbf");
    expect(last.zielbahnhof).toBe("Hamburg Hbf");
    expect(last.abreisedatum).toBe("2026-06-01");
    expect(last.erwartete_erstattung).toBe("15.00");
    // Summary projection: must NOT include the fahrt_-prefixed legacy names
    // (the contract dropped them) or full-ticket fields like state_timeline.
    expect("state_timeline" in last).toBe(false);
    expect("fahrt_abreisedatum" in last).toBe(false);
    expect("fahrt_zugnummer_plan" in last).toBe(false);
  });

  it("only returns the caller's tickets — never another user's", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    // Seed a stranger's ticket directly via the repo; their email isn't
    // even registered, but the ticket repo doesn't care about that.
    await seedTicket(db, "bob@example.com", "01HZZA0000000000000000BOB1", "2026-06-05T10:00:00Z");
    await seedTicket(db, ALICE_EMAIL, "01HZZA00000000000000ALICE1", "2026-06-04T10:00:00Z");

    const res = await handleGetTickets(
      makeEvent({ method: "GET", path: "/users/me/tickets", token: aliceAccessToken() }),
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.map((x: { ticketId: string }) => x.ticketId)).toEqual([
      "01HZZA00000000000000ALICE1",
    ]);
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handleGetTickets(makeEvent({ method: "GET", path: "/users/me/tickets" }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_FORBIDDEN for an ADMIN-role token", async () => {
    const res = await handleGetTickets(
      makeEvent({
        method: "GET",
        path: "/users/me/tickets",
        token: adminAccessToken("admin@example.com"),
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ERR_FORBIDDEN");
  });
});
