import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  adminAccessToken,
  aliceAccessToken,
  aliceRefreshToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("GET /users/me", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the profile view (no iban/bic, no encrypted attrs)", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me", token: aliceAccessToken() }),
    );

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({
      email: "alice@example.com",
      vorname: "Alice",
      nachname: "Müller",
      telefon: "+49 151 1234567",
      user_state: "ACTIVE",
    });
    expect(body.adresse).toEqual({
      strasse: "Bahnhofstr.",
      hausnr: "12",
      plz: "10115",
      ort: "Berlin",
      land: "DE",
    });
    expect(typeof body.created_at).toBe("string");
    // Bank data MUST NOT appear here — that's the whole point of the
    // separate /refund-data endpoint.
    expect(body.iban).toBeUndefined();
    expect(body.bic).toBeUndefined();
    expect(body.iban_enc).toBeUndefined();
    expect(body.bic_enc).toBeUndefined();
    expect(body.hashed_password).toBeUndefined();
  });

  it("ERR_AUTH_INVALID when Authorization header is missing", async () => {
    const res = await handler(makeEvent({ method: "GET", path: "/users/me" }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_AUTH_INVALID on a malformed Authorization header", async () => {
    const res = await handler({
      version: "2.0",
      headers: { authorization: "not-a-bearer-token" },
      requestContext: { http: { method: "GET", path: "/users/me" } },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_AUTH_INVALID when a refresh token is presented as access", async () => {
    // verifyAccessToken rejects tokens carrying typ=refresh.
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me", token: aliceRefreshToken() }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_INVALID");
  });

  it("ERR_FORBIDDEN for an ADMIN role token (admins use admin-handler)", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me",
        token: adminAccessToken("admin@example.com"),
      }),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe("ERR_FORBIDDEN");
  });

  it("ERR_AUTH_EXPIRED when the underlying user row vanished", async () => {
    // Valid token but no row seeded.
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me", token: aliceAccessToken() }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });
});
