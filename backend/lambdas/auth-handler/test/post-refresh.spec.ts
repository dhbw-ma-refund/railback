import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@railback/lib/auth/password";
import {
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "@railback/lib/auth/jwt";
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

function makeRefreshEvent(body: unknown) {
  return {
    version: "2.0" as const,
    headers: {},
    requestContext: { http: { method: "POST", path: "/auth/refresh" } },
    body: JSON.stringify(body),
  };
}

const registerBody = {
  email: "alice@example.com",
  password: "hunter2-secret",
  vorname: "Alice",
  nachname: "Müller",
  telefon: "+49 151 1234567",
  adresse: { strasse: "Bahnhofstr.", hausnr: "12", plz: "10115", ort: "Berlin", land: "DE" },
  iban: "DE89370400440532013000",
  bic: "COBADEFFXXX",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

async function registerAlice(): Promise<string> {
  const r = await handler(makeRegisterEvent(registerBody));
  if (r.statusCode !== 201) throw new Error(`register: ${r.statusCode} ${r.body}`);
  return JSON.parse(r.body).refreshToken;
}

describe("POST /auth/refresh", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("rotates both tokens on a valid USER refresh", async () => {
    const oldRefresh = await registerAlice();
    const res = await handler(makeRefreshEvent({ refreshToken: oldRefresh }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");
    // Access token is new (different sig)
    expect(verifyAccessToken(body.accessToken).sub).toBe("alice@example.com");
    expect(verifyRefreshToken(body.refreshToken).sub).toBe("alice@example.com");
    expect(body.user.role).toBe("USER");
  });

  it("ERR_AUTH_INVALID on malformed body (request shape is bad, not the token)", async () => {
    const res = await handler(makeRefreshEvent({}));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_AUTH_EXPIRED on a tampered token (uniform refresh-failure)", async () => {
    await registerAlice();
    const res = await handler(makeRefreshEvent({ refreshToken: "not.a.jwt" }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });

  it("ERR_AUTH_EXPIRED when the user row was deleted out-of-band", async () => {
    // Sign a refresh token for a user that doesn't exist in this fresh DB
    const phantomRefresh = signRefreshToken({
      email: "ghost@example.com",
      role: "USER",
    });
    const res = await handler(makeRefreshEvent({ refreshToken: phantomRefresh }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });

  it("ERR_FORBIDDEN with user_state=SUSPENDED reflects an admin ban", async () => {
    const db = installTestEnv();
    const oldRefresh = await registerAlice();
    await (db as Db).users.updateProfile("alice@example.com", {
      user_state: "SUSPENDED",
      suspended_reason: "abuse",
    });
    const res = await handler(makeRefreshEvent({ refreshToken: oldRefresh }));
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_FORBIDDEN");
    expect(body.error.details.user_state).toBe("SUSPENDED");
    expect(body.error.details.suspended_reason).toBe("abuse");
  });

  it("ERR_AUTH_EXPIRED when the refresh token itself is expired", async () => {
    const oldRefresh = await registerAlice();
    // Advance system time past the refresh TTL (30d)
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(Date.now() + 31 * 24 * 60 * 60 * 1000));
      const res = await handler(makeRefreshEvent({ refreshToken: oldRefresh }));
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates ADMIN tokens", async () => {
    const db = installTestEnv();
    const hp = await hashPassword("admin-pw");
    const state = _activeMemState();
    if (!state) throw new Error("active memory state not exposed");
    seedAdmin(state, "admin@example.com", hp);
    void db;

    const oldRefresh = signRefreshToken({ email: "admin@example.com", role: "ADMIN" });
    const res = await handler(makeRefreshEvent({ refreshToken: oldRefresh }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.role).toBe("ADMIN");
    expect(verifyAccessToken(body.accessToken).role).toBe("ADMIN");
  });

  it("rejects an access-token used as a refresh-token (ERR_AUTH_EXPIRED)", async () => {
    // Register first so we have a real session
    const r = await handler(makeRegisterEvent(registerBody));
    const access = JSON.parse(r.body).accessToken;
    const res = await handler(makeRefreshEvent({ refreshToken: access }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });
});
