import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAdmin,
  seedAlice,
} from "./fixtures.js";

describe("PATCH /admin/users/{email}", () => {
  beforeEach(async () => {
    installTestEnv();
    await seedAdmin();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("updates profile fields and returns the new detail view", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { telefon: "+49 999 1111111" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.telefon).toBe("+49 999 1111111");
    expect(body.recent_tickets).toEqual([]);
  });

  it("suspends a user when SUSPENDED + suspended_reason provided", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "manuelle prüfung" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user_state).toBe("SUSPENDED");
    expect(body.suspended_reason).toBe("manuelle prüfung");
    expect(typeof body.suspended_at).toBe("string");
  });

  it("rejects SUSPEND without suspended_reason (ERR_VALIDATION)", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED" },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("unbans a SUSPENDED user — clears suspended_at and suspended_reason", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await db.users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_at: "2026-06-01T00:00:00Z",
      suspended_reason: "old reason",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "ACTIVE" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user_state).toBe("ACTIVE");
    expect(body.suspended_at).toBeUndefined();
    expect(body.suspended_reason).toBeUndefined();
  });

  // DB_SCHEMA.md U5: SUSPENDED → DELETION_SCHEDULED clears the suspension
  // metadata (the row is on its way out, no point retaining a stale
  // ban reason on a tombstoned user).
  it("SUSPENDED → DELETION_SCHEDULED clears suspended_at + suspended_reason and sets ttl", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await db.users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_at: "2026-06-01T00:00:00Z",
      suspended_reason: "lasting ban reason",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "DELETION_SCHEDULED" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user_state).toBe("DELETION_SCHEDULED");
    expect(body.suspended_at).toBeUndefined();
    expect(body.suspended_reason).toBeUndefined();
    // ttl is internal — not in admin-view — but assert via the repo.
    const internal = await db.users.getByEmail(ALICE_EMAIL);
    expect(typeof internal?.ttl).toBe("number");
    expect(internal?.suspended_at).toBeUndefined();
    expect(internal?.suspended_reason).toBeUndefined();
  });

  it("rejects DELETION_SCHEDULED → SUSPENDED with ERR_CONFLICT", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await db.users.scheduleDeletion(ALICE_EMAIL);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "nope" },
      }),
    );
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe("ERR_CONFLICT");
  });

  it("ERR_FORBIDDEN with USER token", async () => {
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: aliceAccessToken(),
        body: { telefon: "+49 1" },
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_INVALID with no token", async () => {
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        body: { telefon: "+49 1" },
      }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("rejects forbidden fields (iban, email) via .strict()", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { iban: "DE89370400440532013000" },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  // Regression: SUSPENDED→SUSPENDED re-patch must not overwrite the
  // original suspended_at — that timestamp is the audit-trail anchor.
  it("preserves original suspended_at on SUSPENDED→SUSPENDED re-patch", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await db.users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_at: "2026-06-01T00:00:00.000Z",
      suspended_reason: "initial reason",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", suspended_reason: "updated reason", vorname: "Alice2" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.suspended_at).toBe("2026-06-01T00:00:00.000Z");
    expect(body.suspended_reason).toBe("updated reason");
    expect(body.vorname).toBe("Alice2");
  });

  // Regression: SUSPENDED→SUSPENDED with no suspended_reason in body must
  // not blank out the stored reason.
  it("does not blank suspended_reason when re-patching SUSPENDED without it", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);
    await db.users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_at: "2026-06-01T00:00:00.000Z",
      suspended_reason: "do not lose me",
    });

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent(ALICE_EMAIL)}`,
        token: adminAccessToken(),
        body: { user_state: "SUSPENDED", vorname: "Alice3" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).suspended_reason).toBe("do not lose me");
  });

  // Regression: mixed-case email in path must hit the canonical row.
  it("normalises mixed-case email in path before lookup", async () => {
    const db = installTestEnv();
    await seedAdmin();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: `/admin/users/${encodeURIComponent("Alice@Example.COM")}`,
        token: adminAccessToken(),
        body: { telefon: "+49 1" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).email).toBe(ALICE_EMAIL);
  });
});
