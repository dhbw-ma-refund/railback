import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptBic, decryptIban } from "@railback/lib/crypto/iban";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";
import {
  ALICE_BIC,
  ALICE_IBAN,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "./fixtures.js";

describe("PATCH /users/me", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("updates a single field (telefon) and returns the full profile", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { telefon: "+49 170 0000000" },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.telefon).toBe("+49 170 0000000");
    expect(body.vorname).toBe("Alice"); // unchanged
    expect(body.email).toBe("alice@example.com");
  });

  it("updates the address wholesale", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const newAddress = {
      strasse: "Hauptstr.",
      hausnr: "99",
      plz: "70173",
      ort: "Stuttgart",
      land: "DE",
    };
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { adresse: newAddress },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).adresse).toEqual(newAddress);
  });

  it("ERR_VALIDATION when body has no recognised fields", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: {},
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_VALIDATION on partial address (missing fields)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { adresse: { strasse: "Just one field" } },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("silently ignores forbidden fields (iban/bic/user_state/email)", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: {
          telefon: "+49 170 0000000",
          iban: "DE12500105170648489890",
          bic: "INGDDEFFXXX",
          email: "evil@example.com",
          user_state: "SUSPENDED",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Telefon got through; everything else was stripped.
    expect(body.telefon).toBe("+49 170 0000000");
    expect(body.email).toBe("alice@example.com");
    expect(body.user_state).toBe("ACTIVE");

    // Crucially: IBAN/BIC ciphertext on the row didn't change. Round-trip
    // via /refund-data to be sure.
    const refundRes = await handler(
      makeEvent({
        method: "GET",
        path: "/users/me/refund-data",
        token: aliceAccessToken(),
      }),
    );
    expect(refundRes.statusCode).toBe(200);
    const refund = JSON.parse(refundRes.body);
    expect(refund.iban).toBe(ALICE_IBAN);
    expect(refund.bic).toBe(ALICE_BIC);

    // And as a deeper check: the raw User row's iban_enc still decrypts
    // to the originally-seeded value.
    const u = await db.users.getByEmail("alice@example.com");
    expect(u?.iban_enc).toBeTypeOf("string");
    expect(decryptIban(u!.iban_enc!)).toBe(ALICE_IBAN);
    expect(decryptBic(u!.bic_enc!)).toBe(ALICE_BIC);
  });

  it("ERR_VALIDATION when a string field is over its bound (DoS guard)", async () => {
    // telefon is capped at 40 chars in the schema (DDB-bloat guard).
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { telefon: "x".repeat(100_000) },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handler(
      makeEvent({ method: "PATCH", path: "/users/me", body: { telefon: "x" } }),
    );
    expect(res.statusCode).toBe(401);
  });
});
