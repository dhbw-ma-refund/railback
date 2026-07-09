import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ulid } from "@railback/lib/util/ulid";
import { emailHash } from "@railback/lib";
import type { Db } from "@railback/lib/storage/types";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handlePostUploadConfirm } from "../src/routes/post-upload-confirm.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

const ALICE_HASH = emailHash(ALICE_EMAIL);

// Mirrors what POST /upload writes: TicketOwner + UserTicket(VALIDATING).
// All upload-confirm tests assume /upload has run first, since the row
// creation moved upstream as of 2026-06-24. Since tickets.create() writes
// both rows atomically, one call is enough.
async function prepareUploadedTicket(db: Db, email: string, ticketId: string): Promise<void> {
  await db.tickets.create({
    email,
    ticketId,
    filename: "ticket.pdf",
    s3_key: `raw/${emailHash(email)}/${ticketId}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 0,
    uploadedAt: new Date().toISOString(),
  });
}

describe("POST /users/me/tickets/{ticketId}/upload-confirm", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("writes the RAW# blob row (ticket + owner were created by /upload)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const s3_key = `raw/${ALICE_HASH}/${ticketId}.pdf`;
    await prepareUploadedTicket(db, ALICE_EMAIL, ticketId);

    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: { s3_key, filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({
      ticketId,
      extraction_status: "PROCESSING",
    });

    // Ticket + owner are unchanged (they pre-exist from /upload).
    const t = await db.tickets.get(ALICE_EMAIL, ticketId);
    expect(t).not.toBeNull();
    expect(t!.ticket_state).toBe("VALIDATING");
    expect(t!.extraction_status).toBe("PROCESSING");

    // RAW# is what this handler wrote.
    const raw = await db.blobs.getRawUpload(ALICE_EMAIL, ticketId);
    expect(raw).not.toBeNull();
    expect(raw!.s3_key).toBe(s3_key);
    expect(raw!.content_type).toBe("application/pdf");
    expect(raw!.size_bytes).toBe(0); // placeholder per doc comment

    const owner = await db.ticketOwners.get(ticketId);
    expect(owner).not.toBeNull();
    expect(owner!.email).toBe(ALICE_EMAIL);
  });

  it("ERR_NOT_FOUND when /upload was never called for this ticketId", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const s3_key = `raw/${ALICE_HASH}/${ticketId}.pdf`;

    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: { s3_key, filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe("ERR_NOT_FOUND");
    // No rows were created as a side effect.
    expect(await db.blobs.getRawUpload(ALICE_EMAIL, ticketId)).toBeNull();
  });

  it("is idempotent: a second confirm returns the existing extraction_status", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const s3_key = `raw/${ALICE_HASH}/${ticketId}.pdf`;
    await prepareUploadedTicket(db, ALICE_EMAIL, ticketId);

    const first = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: { s3_key, filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(first.statusCode).toBe(202);

    // Simulate the extractor flipping extraction_status to DONE.
    await db.tickets.patch(ALICE_EMAIL, ticketId, {
      extraction_status: "DONE",
      updated_at: new Date().toISOString(),
    });

    const second = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: { s3_key, filename: "ticket.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(second.statusCode).toBe(202);
    expect(JSON.parse(second.body)).toEqual({
      ticketId,
      extraction_status: "DONE",
    });
  });

  it("ERR_VALIDATION on missing s3_key", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: { filename: "x.pdf", mimeType: "application/pdf" },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_VALIDATION on unsupported mimeType", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: {
          s3_key: `raw/h/${ticketId}.zip`,
          filename: "x.zip",
          mimeType: "application/zip",
        },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_VALIDATION on a malformed ticketId in the path", async () => {
    installTestEnv();
    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: "/users/me/tickets/not-a-ulid/upload-confirm",
        token: aliceAccessToken(),
        body: {
          s3_key: "raw/h/x.pdf",
          filename: "x.pdf",
          mimeType: "application/pdf",
        },
        pathParameters: { ticketId: "not-a-ulid" },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        body: {
          s3_key: `raw/h/${ticketId}.pdf`,
          filename: "x.pdf",
          mimeType: "application/pdf",
        },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN when caller is an ADMIN", async () => {
    installTestEnv();
    const ticketId = ulid();
    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: adminAccessToken("admin@railback.local"),
        body: {
          s3_key: `raw/h/${ticketId}.pdf`,
          filename: "x.pdf",
          mimeType: "application/pdf",
        },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_VALIDATION when s3_key doesn't match the expected raw-upload key shape (defence in depth)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const ticketId = ulid();
    await prepareUploadedTicket(db, ALICE_EMAIL, ticketId);

    const res = await handlePostUploadConfirm(
      makeEvent({
        method: "POST",
        path: `/users/me/tickets/${ticketId}/upload-confirm`,
        token: aliceAccessToken(),
        body: {
          // Wrong email-hash + arbitrary ticketId pointing at someone else's file.
          s3_key: `raw/deadbeef/${ulid()}.pdf`,
          filename: "x.pdf",
          mimeType: "application/pdf",
        },
        pathParameters: { ticketId },
      }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
    expect(body.error.details?.field).toBe("s3_key");
    // No RAW# row was created.
    expect(await db.blobs.getRawUpload(ALICE_EMAIL, ticketId)).toBeNull();
  });
});
