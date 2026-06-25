import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostUpload } from "../src/routes/post-upload.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("POST /users/me/tickets/{ticketId}/upload", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("issues a presigned POST AND creates the ticket + owner rows", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();

    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticketId).toBe(ticketId);
    expect(typeof body.uploadUrl).toBe("string");
    expect(body.s3_key).toContain(ticketId);
    expect(body.expiresIn).toBeGreaterThan(0);
    expect(body.fields).toMatchObject({
      "Content-Type": "application/pdf",
    });
    // Locked 2026-06-24: ticket + owner rows are created here, BEFORE the
    // presign is returned. This closes the race where the S3
    // ObjectCreated event could fire before upload-confirm wrote them.
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t).not.toBeNull();
    expect(t!.ticket_state).toBe("VALIDATING");
    expect(t!.extraction_status).toBe("PROCESSING");
    const owner = await db.ticketOwners.get(ticketId);
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe(ALICE_EMAIL);
    // RAW# is still upload-confirm's job — not created yet.
    expect(await db.blobs.getRawUpload(ALICE_EMAIL, ticketId)).toBeNull();
  });

  it("is idempotent: re-presign on a VALIDATING ticket reuses the existing rows", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();

    const first = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(first.statusCode).toBe(200);
    const firstCreatedAt = (await db.tickets.get(ALICE_EMAIL, ticketId))!.uploaded_at;

    const second = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(second.statusCode).toBe(200);
    // The existing ticket row was not recreated.
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t!.uploaded_at).toBe(firstCreatedAt);
  });

  it("ERR_CONFLICT when ticketId belongs to a different user", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    // Bob already owns this ticketId.
    await db.ticketOwners.put(ticketId, "bob@example.com");

    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
    // Alice's tickets table is unchanged.
    expect(await db.tickets.get(ALICE_EMAIL, ticketId)).toBeNull();
  });

  it("allows a re-presign while the existing ticket is still VALIDATING", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    await db.tickets.create({
      email: ALICE_EMAIL,
      ticketId,
      filename: "x.pdf",
      s3_key: `raw/h/${ticketId}.pdf`,
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 0,
      uploadedAt: new Date().toISOString(),
    });

    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(200);
  });

  it("ERR_CONFLICT when ticket exists and is no longer pending", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    await db.tickets.create({
      email: ALICE_EMAIL,
      ticketId,
      filename: "x.pdf",
      s3_key: `raw/h/${ticketId}.pdf`,
      mimeType: "application/pdf",
      contentType: "application/pdf",
      sizeBytes: 0,
      uploadedAt: new Date().toISOString(),
    });
    // Advance the ticket past VALIDATING.
    await db.tickets.patch(ALICE_EMAIL, ticketId, {
      ticket_state: "READY",
      extraction_status: "DONE",
      updated_at: new Date().toISOString(),
    });

    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(409);
    const err = JSON.parse(res.body).error;
    expect(err.code).toBe("ERR_CONFLICT");
    expect(err.details?.existing_ticket_id).toBe(ticketId);
  });

  it("ERR_CONFLICT when ticketId belongs to a MANUAL_ROUTE ticket", async () => {
    const db = installTestEnv();
    await seedAlice(db);
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

    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
  });

  it("ERR_VALIDATION on a bad mimeType", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/zip" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_VALIDATION on a malformed ticketId in the path", async () => {
    installTestEnv();
    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/not-a-ulid/upload",
        token: aliceAccessToken(),
        body: { filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId: "not-a-ulid" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        body: { filename: "x.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN when caller is an ADMIN", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostUpload(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload`,
        token: adminAccessToken("admin@railback.local"),
        body: { filename: "x.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(403);
  });
});
