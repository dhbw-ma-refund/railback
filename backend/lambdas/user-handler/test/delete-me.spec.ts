import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Db } from "@railback/lib/storage/types";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_EMAIL,
  ALICE_PASSWORD,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("DELETE /users/me", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("schedules deletion (204) on correct confirmPassword", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");

    const u = await db.users.getByEmail(ALICE_EMAIL);
    expect(u?.user_state).toBe("DELETION_SCHEDULED");
    // TTL set to +30 days (seconds). Allow a wide window.
    const now = Math.floor(Date.now() / 1000);
    expect(u?.ttl).toBeGreaterThan(now + 29 * 86400);
    expect(u?.ttl).toBeLessThan(now + 31 * 86400);
  });

  it("ERR_AUTH_INVALID on wrong confirmPassword (no state leak)", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: "wrong-password" },
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");

    // Account NOT scheduled for deletion.
    const u = await db.users.getByEmail(ALICE_EMAIL);
    expect(u?.user_state).toBe("ACTIVE");
    expect(u?.ttl).toBeUndefined();
  });

  it("ERR_VALIDATION when confirmPassword is missing", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_FORBIDDEN for SUSPENDED accounts (with correct password)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await (db as Db).users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_reason: "spam",
    });

    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_FORBIDDEN");
    expect(body.error.details?.user_state).toBe("SUSPENDED");
    expect(body.error.details?.suspended_reason).toBe("spam");

    // Still SUSPENDED, not flipped to DELETION_SCHEDULED.
    const u = await db.users.getByEmail(ALICE_EMAIL);
    expect(u?.user_state).toBe("SUSPENDED");
  });

  it("SUSPENDED + wrong password: ERR_AUTH_INVALID (no state leak)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    await (db as Db).users.updateProfile(ALICE_EMAIL, {
      user_state: "SUSPENDED",
      suspended_reason: "spam",
    });

    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: "wrong-password" },
      }),
    );
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_AUTH_INVALID");
    // Crucially: details must NOT carry user_state / suspended_reason —
    // otherwise an attacker who knows the email can enumerate ban state
    // without a valid password.
    expect(body.error.details).toBeUndefined();
  });

  it("idempotent on DELETION_SCHEDULED (returns 204 again)", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const first = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(first.statusCode).toBe(204);
    const ttlAfterFirst = (await db.users.getByEmail(ALICE_EMAIL))?.ttl;

    const second = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(second.statusCode).toBe(204);
    // TTL on the row didn't reset (we no-op'd) — proves the second call
    // didn't re-run scheduleDeletion.
    const u = await db.users.getByEmail(ALICE_EMAIL);
    expect(u?.user_state).toBe("DELETION_SCHEDULED");
    expect(u?.ttl).toBe(ttlAfterFirst);
  });

  it("ERR_AUTH_EXPIRED when the user row has vanished", async () => {
    // Valid token, no seeded row.
    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
