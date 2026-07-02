import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "@railback/lib/auth/password";
import { verifyAccessToken } from "@railback/lib/auth/jwt";
import type { Db } from "@railback/lib/storage/types";
import { _activeMemState, seedAdmin } from "@railback/mocks-in-memory";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";

function makeRegisterEvent(body: unknown) {
  return {
    version: "2.0" as const,
    headers: {},
    requestContext: { http: { method: "POST", path: "/auth/register" } },
    body: JSON.stringify(body),
  };
}

function makeLoginEvent(body: unknown) {
  return {
    version: "2.0" as const,
    headers: {},
    requestContext: { http: { method: "POST", path: "/auth/login" } },
    body: JSON.stringify(body),
  };
}

const registerBody = {
  email: "alice@example.com",
  password: "hunter2-secret",
  vorname: "Alice",
  nachname: "Müller",
  telefon: "+49 151 1234567",
  adresse: {
    strasse: "Bahnhofstr.",
    hausnr: "12",
    plz: "10115",
    ort: "Berlin",
    land: "DE",
  },
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

async function registerAlice(): Promise<void> {
  const r = await handler(makeRegisterEvent(registerBody));
  if (r.statusCode !== 201) {
    throw new Error(`register failed: ${r.statusCode} ${r.body}`);
  }
}

describe("POST /auth/login (USER path)", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns 200 + USER tokens on valid credentials", async () => {
    await registerAlice();
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "hunter2-secret" }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe("USER");
    expect(body.user.vorname).toBe("Alice");
    expect(verifyAccessToken(body.accessToken).role).toBe("USER");
  });

  it("ERR_AUTH_INVALID on wrong password", async () => {
    await registerAlice();
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "wrong" }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_AUTH_INVALID on unknown email (doesn't leak existence)", async () => {
    const res = await handler(
      makeLoginEvent({ email: "ghost@example.com", password: "anything" }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_AUTH_INVALID on malformed body", async () => {
    const res = await handler(makeLoginEvent({ no_email: true }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_FORBIDDEN with user_state=SUSPENDED + suspended_reason in details (correct password)", async () => {
    const db = installTestEnv();
    await registerAlice();
    await (db as Db).users.updateProfile("alice@example.com", {
      user_state: "SUSPENDED",
      suspended_reason: "spam",
    });
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "hunter2-secret" }),
    );
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_FORBIDDEN");
    expect(body.error.details.user_state).toBe("SUSPENDED");
    expect(body.error.details.suspended_reason).toBe("spam");
  });

  it("SUSPENDED account with WRONG password → ERR_AUTH_INVALID (no state leak)", async () => {
    // Password-first verify: an attacker who knows the email but not the
    // password can't enumerate "this account is suspended".
    const db = installTestEnv();
    await registerAlice();
    await (db as Db).users.updateProfile("alice@example.com", {
      user_state: "SUSPENDED",
      suspended_reason: "abuse",
    });
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "wrong" }),
    );
    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_AUTH_INVALID");
    // Critical: details must NOT carry user_state / suspended_reason
    expect(body.error.details).toBeUndefined();
  });

  it("DELETION_SCHEDULED with wrong password also returns ERR_AUTH_INVALID (no leak)", async () => {
    const db = installTestEnv();
    await registerAlice();
    await (db as Db).users.scheduleDeletion("alice@example.com");
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "wrong" }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_FORBIDDEN with user_state=DELETION_SCHEDULED (no reason field)", async () => {
    const db = installTestEnv();
    await registerAlice();
    await (db as Db).users.scheduleDeletion("alice@example.com");
    const res = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "hunter2-secret" }),
    );
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_FORBIDDEN");
    expect(body.error.details.user_state).toBe("DELETION_SCHEDULED");
    expect(body.error.details.suspended_reason).toBeUndefined();
  });
});

describe("POST /auth/login (ADMIN path)", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns 200 + ADMIN tokens for an admin row", async () => {
    const db = installTestEnv();
    const hp = await hashPassword("admin-pw");
    expect(await db.admins.getByEmail("admin@example.com")).toBeNull();
    const state = _activeMemState();
    if (!state) throw new Error("active memory state not exposed by mocks");
    seedAdmin(state, "admin@example.com", hp);

    const res = await handler(
      makeLoginEvent({ email: "admin@example.com", password: "admin-pw" }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe("ADMIN");
    expect(body.user.email).toBe("admin@example.com");
    expect(verifyAccessToken(body.accessToken).role).toBe("ADMIN");
  });

  it("admin row wins over user row when both exist", async () => {
    const db = installTestEnv();
    // First make a user row
    await handler({
      version: "2.0" as const,
      headers: {},
      requestContext: { http: { method: "POST", path: "/auth/register" } },
      body: JSON.stringify(registerBody),
    } as never);

    // Now also seed an admin row with the SAME email
    const hp = await hashPassword("admin-only-pw");
    const state = _activeMemState();
    if (!state) throw new Error("active memory state not exposed by mocks");
    seedAdmin(state, "alice@example.com", hp);

    // Login with the admin password → role=ADMIN
    const adminRes = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "admin-only-pw" }),
    );
    expect(adminRes.statusCode).toBe(200);
    expect(JSON.parse(adminRes.body).user.role).toBe("ADMIN");

    // Login with the user-only password → fails (admin lookup hits first,
    // password mismatch → ERR_AUTH_INVALID; user-fallback is NOT tried)
    const userRes = await handler(
      makeLoginEvent({ email: "alice@example.com", password: "hunter2-secret" }),
    );
    expect(userRes.statusCode).toBe(401);

    void db;
  });
});
