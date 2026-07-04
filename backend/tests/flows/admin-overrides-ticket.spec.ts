// Phase 4 cross-Lambda flow — admin overrides on tickets + users.
//
// Covers:
//  1. admin approves → pain008 built + ticket state visible to user
//  2. admin rejects → ttl stamped + REJECTED visible to user
//  3. admin cannot edit refund amount (strict schema rejects)
//  4. admin ban → user login + refresh rejected with ERR_FORBIDDEN
//  5. admin restores banned user → login works again
//
// no direct @aws-sdk imports. every it() calls installTestEnv() inline for
// a fresh MemState. we simulate the python ticket-extractor by direct
// db writes where needed.

import { afterEach, describe, expect, it } from "vitest";

import { db as dbAccessor } from "@railback/lib/storage";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { ulid } from "@railback/lib/util/ulid";
import type { Db } from "@railback/lib/storage/types";

import { handler as adminHandler } from "@railback/lambdas-admin-handler/src/handler.js";
import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";
import { handler as authHandler } from "@railback/lambdas-auth-handler/src/handler.js";

import { installTestEnv, teardownTestEnv } from "../shared/env.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ALICE_EMAIL,
  ALICE_PASSWORD,
  ALICE_IBAN,
  ALICE_BIC,
  adminAccessToken,
  aliceAccessToken,
  aliceRefreshToken,
  makeEvent,
  seedAdmin,
  seedAlice,
} from "../shared/fixtures.js";

// --- local seeding helpers ---------------------------------------------
//
// mirrors lambdas/admin-handler/test/fixtures.ts seedTicket / seedMandate
// so we don't have to reach across a lambda-local test folder.

async function seedSubmittedTicket(
  db: Db,
  email: string,
  ticketId: string,
  overrides: {
    ticket_state?: "PENDING_DB_PAYMENT" | "APPROVED";
    erwartete_erstattung?: string;
    service_fee_betrag?: string;
    antragsart?: "ENTSCHAEDIGUNG_60_119" | "ENTSCHAEDIGUNG_120_PLUS";
    submitted_at?: string;
  } = {},
): Promise<void> {
  // Real ticket-extractor runs in python; this simulates its persist step
  // by creating the row directly and then walking it up the state ladder.
  await db.tickets.create({
    email,
    ticketId,
    filename: "ticket.pdf",
    s3_key: `raw/${email}/${ticketId}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    uploadedAt: new Date().toISOString(),
  });
  await db.ticketOwners.put(ticketId, email);

  // walk through the state ladder so state_timeline carries intermediate stamps.
  // No inter-patch sleeps: state_timeline is append-only and no assertion in
  // this file relies on strict ms-level monotonicity between entries; keeping
  // setTimeout(r, 2) here made the seed dependent on host timer resolution.
  const history: ReadonlyArray<
    "READY" | "EMAIL_SENDING" | "PENDING_DB_PAYMENT" | "APPROVED"
  > = ["READY", "EMAIL_SENDING"];
  for (const s of history) {
    await db.tickets.patch(email, ticketId, { ticket_state: s });
  }

  // Real extractor runs in Python; this simulates its persist step by
  // stamping extraction + fahrt_* fields directly.
  const patch: Record<string, unknown> = {
    ticket_state: overrides.ticket_state ?? "PENDING_DB_PAYMENT",
    extraction_method: "BARCODE",
    extraction_confidence: 1.0,
    extraction_status: "DONE",
    fahrt_abreisedatum: "2026-06-23",
    fahrt_abreisebahnhof: "Berlin Hauptbahnhof",
    fahrt_zielbahnhof: "München Hbf",
    fahrt_zugnummer_plan: "ICE 555",
    fahrt_fahrkartenpreis: "100.00",
    antragsart: overrides.antragsart ?? "ENTSCHAEDIGUNG_60_119",
    antragsgrund: ["VERSPAETUNG"],
    delayMinutes: 90,
    erwartete_erstattung: overrides.erwartete_erstattung ?? "25.00",
    service_fee_betrag: overrides.service_fee_betrag ?? "0.75",
    service_fee_state: "PENDING",
    submitted_at: overrides.submitted_at ?? new Date().toISOString(),
    email_status: "SENT",
    email_attempts: 1,
  };
  await db.tickets.patch(email, ticketId, patch);
}

async function seedMandateFor(
  db: Db,
  email: string,
  ticketId: string,
  submittedAt: string,
): Promise<void> {
  await db.mandates.issue(email, ticketId, {
    ticketId,
    fee_amount: "0.75",
    iban_enc: encryptIban(ALICE_IBAN),
    bic_enc: encryptBic(ALICE_BIC),
    kontoinhaber_snapshot: "Alice Müller",
    user_consent_at: submittedAt,
    vorabankuendigung_sent_at: submittedAt,
  });
}

// --- specs -------------------------------------------------------------

describe("flow — admin overrides ticket + user state", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("admin approves → user sees APPROVED + pain008 built + db_paid_at", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const ticketId = ulid();
    const submittedAt = "2026-06-24T08:00:00.000Z";
    await seedSubmittedTicket(db, ALICE_EMAIL, ticketId, { submitted_at: submittedAt });
    await seedMandateFor(db, ALICE_EMAIL, ticketId, submittedAt);

    // exercises real /auth/login → admin dispatch (codex 2026-07-04 finding)
    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      }),
    );
    expect(loginRes.statusCode).toBe(200);
    const { accessToken: adminToken } = JSON.parse(loginRes.body);

    const dbPaidAt = "2026-06-25T10:00:00.000Z";
    const res = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${ticketId}`,
        token: adminToken,
        body: { ticket_state: "APPROVED", db_paid_at: dbPaidAt },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ticket_state).toBe("APPROVED");
    expect(body.db_paid_at).toBe(dbPaidAt);

    // pain008-generator got invoked → mandate stamped
    const mandate = await dbAccessor().mandates.get(ALICE_EMAIL, ticketId);
    expect(mandate).not.toBeNull();
    expect(mandate!.pain008_batch_id).toBeDefined();
    expect(typeof mandate!.pain008_batch_id).toBe("string");
    expect(mandate!.pain008_s3_key).toMatch(
      /^pain008\/\d{4}-\d{2}\/[0-9A-HJKMNP-TV-Z]{26}\.xml$/,
    );
    expect(typeof mandate!.pain008_built_at).toBe("string");

    // user sees the approval through GET /users/me/tickets/{id}
    const userRes = await userHandler(
      makeEvent({
        method: "GET",
        path: `/users/me/tickets/${ticketId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
      }),
    );
    expect(userRes.statusCode).toBe(200);
    const userBody = JSON.parse(userRes.body);
    expect(userBody.ticket_state).toBe("APPROVED");
    expect(userBody.db_paid_at).toBe(dbPaidAt);
  });

  it("admin rejects → user sees REJECTED + ttl stamped ~90d", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const ticketId = ulid();
    await seedSubmittedTicket(db, ALICE_EMAIL, ticketId);

    const before = Math.floor(Date.now() / 1000);
    const res = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${ticketId}`,
        token: adminAccessToken(),
        body: { ticket_state: "REJECTED", admin_note: "duplicate submission" },
      }),
    );
    const after = Math.floor(Date.now() / 1000);
    expect(res.statusCode).toBe(200);

    // ttl stamped ~90d out (DB_SCHEMA §DSGVO, 90d for terminal-no-money rows)
    const row = await dbAccessor().tickets.get(ALICE_EMAIL, ticketId);
    expect(row?.ticket_state).toBe("REJECTED");
    expect(row?.ttl).toBeGreaterThanOrEqual(before + 90 * 24 * 60 * 60);
    expect(row?.ttl).toBeLessThanOrEqual(after + 90 * 24 * 60 * 60);

    // user sees the rejection. get-ticket.ts:80 exposes admin_note to the
    // caller, so we assert it flows through.
    const userRes = await userHandler(
      makeEvent({
        method: "GET",
        path: `/users/me/tickets/${ticketId}`,
        token: aliceAccessToken(),
        pathParameters: { ticketId },
      }),
    );
    expect(userRes.statusCode).toBe(200);
    const userBody = JSON.parse(userRes.body);
    expect(userBody.ticket_state).toBe("REJECTED");
    expect(userBody.admin_note).toBe("duplicate submission");
  });

  it("admin cannot edit refund amount — 400 ERR_VALIDATION, ticket unchanged", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    const ticketId = ulid();
    await seedSubmittedTicket(db, ALICE_EMAIL, ticketId, {
      erwartete_erstattung: "25.00",
    });

    const res = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/tickets/${ticketId}`,
        token: adminAccessToken(),
        body: { ticket_state: "APPROVED", erwartete_erstattung: "999.99" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");

    // ticket unchanged: still PENDING_DB_PAYMENT, amount still 25.00
    const row = await dbAccessor().tickets.get(ALICE_EMAIL, ticketId);
    expect(row?.ticket_state).toBe("PENDING_DB_PAYMENT");
    expect(row?.erwartete_erstattung).toBe("25.00");
  });

  it("admin ban → login + refresh rejected with 403 ERR_FORBIDDEN", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    // grab a refresh token BEFORE the ban lands. the refresh route re-reads
    // the user row on every call so a still-valid signed token is rejected.
    const refreshToken = aliceRefreshToken();

    const banRes = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${ALICE_EMAIL}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "test ban" },
      }),
    );
    expect(banRes.statusCode).toBe(200);

    // POST /auth/login → 403 with details.user_state = SUSPENDED
    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ALICE_EMAIL, password: ALICE_PASSWORD },
      }),
    );
    expect(loginRes.statusCode).toBe(403);
    const loginErr = JSON.parse(loginRes.body).error;
    expect(loginErr.code).toBe("ERR_FORBIDDEN");
    expect(loginErr.details?.user_state).toBe("SUSPENDED");

    // POST /auth/refresh → 403 too (row is re-read on every refresh)
    const refreshRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/refresh",
        body: { refreshToken },
      }),
    );
    expect(refreshRes.statusCode).toBe(403);
    expect(JSON.parse(refreshRes.body).error.code).toBe("ERR_FORBIDDEN");
  });

  it("admin restores banned user → login works, fresh tokens issued", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    // ban first (mirror spec 4 setup)
    const banRes = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${ALICE_EMAIL}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "test ban" },
      }),
    );
    expect(banRes.statusCode).toBe(200);

    // then unban
    const unbanRes = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${ALICE_EMAIL}`,
        token: adminAccessToken(),
        body: { user_state: "ACTIVE" },
      }),
    );
    expect(unbanRes.statusCode).toBe(200);

    // login works again
    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ALICE_EMAIL, password: ALICE_PASSWORD },
      }),
    );
    expect(loginRes.statusCode).toBe(200);
    const loginBody = JSON.parse(loginRes.body);
    expect(typeof loginBody.accessToken).toBe("string");
    expect(loginBody.accessToken.length).toBeGreaterThan(0);
    expect(typeof loginBody.refreshToken).toBe("string");
    expect(loginBody.refreshToken.length).toBeGreaterThan(0);
    expect(loginBody.user?.email).toBe(ALICE_EMAIL);
    expect(loginBody.user?.role).toBe("USER");
  });

  it("admin DELETION_SCHEDULED → SUSPENDED rejected with 409 ERR_CONFLICT", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    // Land Alice in DELETION_SCHEDULED via the same repo the /users/me
    // self-delete route uses. Direct write; not going through the wire
    // to keep the setup terse.
    await db.users.scheduleDeletion(ALICE_EMAIL);
    const preState = await db.users.getByEmailForAuth(ALICE_EMAIL);
    expect(preState?.user_state).toBe("DELETION_SCHEDULED");

    // Admin attempts the forbidden DELETION_SCHEDULED → SUSPENDED transition.
    const res = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${ALICE_EMAIL}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "cannot un-schedule" },
      }),
    );
    expect(res.statusCode).toBe(409);
    const err = JSON.parse(res.body).error;
    expect(err.code).toBe("ERR_CONFLICT");
    expect(err.details?.from).toBe("DELETION_SCHEDULED");
    expect(err.details?.to).toBe("SUSPENDED");

    // Row untouched.
    const postState = await db.users.getByEmailForAuth(ALICE_EMAIL);
    expect(postState?.user_state).toBe("DELETION_SCHEDULED");
  });

  it("suspended user cannot self-delete → 403 ERR_FORBIDDEN, user_state unchanged", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    // Ban Alice.
    const banRes = await adminHandler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${ALICE_EMAIL}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "test ban" },
      }),
    );
    expect(banRes.statusCode).toBe(200);

    // Try DELETE /users/me with the correct confirmPassword. Alice already
    // has a signed access token from before the ban (aliceAccessToken() is
    // a fresh HS256 sign — role stays USER, backend re-reads the row and
    // must refuse).
    const delRes = await userHandler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(delRes.statusCode).toBe(403);
    const err = JSON.parse(delRes.body).error;
    expect(err.code).toBe("ERR_FORBIDDEN");
    expect(err.details?.user_state).toBe("SUSPENDED");

    // user_state must still be SUSPENDED (not flipped to DELETION_SCHEDULED).
    const after = await db.users.getByEmailForAuth(ALICE_EMAIL);
    expect(after?.user_state).toBe("SUSPENDED");
  });
});
