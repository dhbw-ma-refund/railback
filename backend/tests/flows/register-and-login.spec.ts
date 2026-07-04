// End-to-end auth flow: register → login → refresh → /users/me.
// Cross-lambda: exercises auth-handler (register/login/refresh) and
// user-handler (/users/me) against the shared in-memory backend.
//
// Every it() calls installTestEnv() in-line so each test gets a fresh
// MemState — no leakage between cases.

import { afterEach, describe, expect, it } from "vitest";

import { handler as authHandler } from "@railback/lambdas-auth-handler/src/handler.js";
import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";

import { installTestEnv, teardownTestEnv } from "../shared/env.js";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ALICE_EMAIL,
  ALICE_IBAN,
  ALICE_BIC,
  ALICE_PASSWORD,
  aliceProfile,
  makeEvent,
  seedAdmin,
} from "../shared/fixtures.js";

function registerBody() {
  // registerRequestSchema needs: email/password/vorname/nachname/telefon/
  // adresse/iban/bic + two literal-true consent flags. aliceProfile carries
  // the profile subset; we splice in creds + bank data.
  return {
    email: aliceProfile.email,
    password: ALICE_PASSWORD,
    vorname: aliceProfile.vorname,
    nachname: aliceProfile.nachname,
    telefon: aliceProfile.telefon,
    adresse: aliceProfile.adresse,
    iban: ALICE_IBAN,
    bic: ALICE_BIC,
    datenschutz_einwilligung: true as const,
    agb_akzeptiert: true as const,
  };
}

describe("auth flow — register / login / refresh / /users/me", () => {
  afterEach(() => {
    teardownTestEnv();
  });

  it("happy path: register → login → /users/me projects away iban/bic", async () => {
    installTestEnv();

    const regRes = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(regRes.statusCode).toBe(201);
    const reg = JSON.parse(regRes.body);
    expect(typeof reg.accessToken).toBe("string");
    expect(typeof reg.refreshToken).toBe("string");
    expect(typeof reg.expiresIn).toBe("number");
    expect(reg.user).toEqual({
      email: ALICE_EMAIL,
      vorname: aliceProfile.vorname,
      nachname: aliceProfile.nachname,
      role: "USER",
    });

    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ALICE_EMAIL, password: ALICE_PASSWORD },
      }),
    );
    expect(loginRes.statusCode).toBe(200);
    const login = JSON.parse(loginRes.body);
    expect(typeof login.accessToken).toBe("string");
    expect(typeof login.refreshToken).toBe("string");
    expect(login.user.email).toBe(ALICE_EMAIL);
    expect(login.user.role).toBe("USER");

    const meRes = await userHandler(
      makeEvent({ method: "GET", path: "/users/me", token: login.accessToken }),
    );
    expect(meRes.statusCode).toBe(200);
    const me = JSON.parse(meRes.body);
    expect(me.email).toBe(ALICE_EMAIL);
    // profileView must never surface bank data — DSGVO data-minimisation.
    expect(me.iban).toBeUndefined();
    expect(me.bic).toBeUndefined();
    expect(me.iban_enc).toBeUndefined();
    expect(me.bic_enc).toBeUndefined();
  });

  it("register-issued tokens are immediately usable against /users/me", async () => {
    installTestEnv();

    const regRes = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(regRes.statusCode).toBe(201);
    const { accessToken } = JSON.parse(regRes.body);

    const meRes = await userHandler(
      makeEvent({ method: "GET", path: "/users/me", token: accessToken }),
    );
    expect(meRes.statusCode).toBe(200);
    const me = JSON.parse(meRes.body);
    expect(me.email).toBe(ALICE_EMAIL);
  });

  it("refresh: new tokens work; refreshToken is rotated", async () => {
    installTestEnv();

    const regRes = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(regRes.statusCode).toBe(201);
    const initial = JSON.parse(regRes.body);

    // JWT iat/exp are seconds-precision (nowSec = Math.floor(Date.now()/1000))
    // and the HS256 payload otherwise matches — same-second refresh returns
    // the byte-identical token. Sleep past the 1-second boundary so the
    // rotation invariant is testable.
    await new Promise((r) => setTimeout(r, 1100));

    const refreshRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/refresh",
        body: { refreshToken: initial.refreshToken },
      }),
    );
    expect(refreshRes.statusCode).toBe(200);
    const refreshed = JSON.parse(refreshRes.body);
    expect(typeof refreshed.accessToken).toBe("string");
    expect(typeof refreshed.refreshToken).toBe("string");
    // Rotation — per CLAUDE.md "returns new accessToken + rotated refreshToken".
    expect(refreshed.refreshToken).not.toBe(initial.refreshToken);

    const meRes = await userHandler(
      makeEvent({ method: "GET", path: "/users/me", token: refreshed.accessToken }),
    );
    expect(meRes.statusCode).toBe(200);
    expect(JSON.parse(meRes.body).email).toBe(ALICE_EMAIL);
  });

  it("wrong password → 401 ERR_AUTH_INVALID", async () => {
    installTestEnv();

    const regRes = await authHandler(
      makeEvent({ method: "POST", path: "/auth/register", body: registerBody() }),
    );
    expect(regRes.statusCode).toBe(201);

    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ALICE_EMAIL, password: "definitely-not-the-password" },
      }),
    );
    expect(loginRes.statusCode).toBe(401);
    expect(JSON.parse(loginRes.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("admin login → ADMIN token → /users/me 403 ERR_FORBIDDEN", async () => {
    installTestEnv();
    await seedAdmin();

    const loginRes = await authHandler(
      makeEvent({
        method: "POST",
        path: "/auth/login",
        body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      }),
    );
    expect(loginRes.statusCode).toBe(200);
    const login = JSON.parse(loginRes.body);
    expect(login.user.role).toBe("ADMIN");

    // user-handler's requireUserCaller rejects role !== "USER" with
    // ERR_FORBIDDEN — admins have no /users/me path.
    const meRes = await userHandler(
      makeEvent({ method: "GET", path: "/users/me", token: login.accessToken }),
    );
    expect(meRes.statusCode).toBe(403);
    expect(JSON.parse(meRes.body).error.code).toBe("ERR_FORBIDDEN");
  });
});
