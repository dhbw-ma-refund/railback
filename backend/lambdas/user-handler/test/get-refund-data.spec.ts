import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_BIC,
  ALICE_IBAN,
  adminAccessToken,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("GET /users/me/refund-data", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("returns the EU-form field set with decrypted IBAN + BIC", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      vorname: "Alice",
      nachname: "Müller",
      email: "alice@example.com",
      telefon: "+49 151 1234567",
      adresse: {
        strasse: "Bahnhofstr.",
        hausnr: "12",
        plz: "10115",
        ort: "Berlin",
        land: "DE",
      },
      iban: ALICE_IBAN,
      bic: ALICE_BIC,
    });
    // user_state is NOT part of the refund-data view.
    expect(body.user_state).toBeUndefined();
    expect(body.iban_enc).toBeUndefined();
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handler(
      makeEvent({ method: "GET", path: "/users/me/refund-data" }),
    );
    expect(res.statusCode).toBe(401);
  });

  it("ERR_FORBIDDEN for ADMIN role", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: adminAccessToken("admin@example.com"),
      }),
    );
    expect(res.statusCode).toBe(403);
  });

  it("ERR_AUTH_EXPIRED when the user row is gone", async () => {
    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error.code).toBe("ERR_AUTH_EXPIRED");
  });

  it("returns iban/bic = null on corrupted-blob (does not 500-leak)", async () => {
    // Corrupted ciphertext on the row simulates KEK rotation or a
    // back-up restore that crossed a key change. The view degrades to
    // null rather than surfacing an ERR_INTERNAL — the frontend's
    // remedy in either case is re-collect via PATCH /users/me/bank.
    const db = installTestEnv();
    await seedAlice(db);
    await db.users.updateProfile("alice@example.com", {
      iban_enc: "not-a-valid-base64-blob!!!",
      bic_enc: "neither-is-this",
    });

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.iban).toBeNull();
    expect(body.bic).toBeNull();
  });

  it("ERR_INTERNAL (500) when RAILBACK_IBAN_KEK is missing (server misconfig must NOT degrade silently)", async () => {
    // Seed under a valid KEK, then clobber the env to simulate a broken
    // deploy. The view MUST 500 — a "user has no bank data" response
    // would hide the outage and steer users into a useless re-collect
    // loop.
    const db = installTestEnv();
    await seedAlice(db);
    // Reach past installTestEnv: remove KEK + reset the cached value.
    const { vi } = await import("vitest");
    const { resetKekCache } = await import("@railback/lib/crypto/kek");
    vi.stubEnv("RAILBACK_IBAN_KEK", "");
    resetKekCache();

    const res = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error.code).toBe("ERR_INTERNAL");
  });
});
