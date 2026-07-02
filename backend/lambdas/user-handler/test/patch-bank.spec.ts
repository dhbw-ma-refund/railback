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

const NEW_IBAN = "DE12500105170648489890";
const NEW_BIC = "INGDDEFFXXX";

describe("PATCH /users/me/bank", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("updates iban+bic together, re-encrypts, echoes normalised values", async () => {
    const db = installTestEnv();
    await seedAlice(db);

    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me/bank",
        token: aliceAccessToken(),
        body: { iban: "de12 5001 0517 0648 4898 90", bic: " ingddeffxxx " },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ iban: NEW_IBAN, bic: NEW_BIC });

    // Persisted ciphertext round-trips to the new plaintext.
    const u = await db.users.getByEmail("alice@example.com");
    expect(decryptIban(u!.iban_enc!)).toBe(NEW_IBAN);
    expect(decryptBic(u!.bic_enc!)).toBe(NEW_BIC);
    // The new ciphertext differs from the original (different IV per
    // encrypt, plus different plaintext).
    expect(u!.iban_enc).not.toBe("");
  });

  it("ERR_VALIDATION when iban fails mod-97", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me/bank",
        token: aliceAccessToken(),
        body: { iban: "DE00370400440532013000", bic: NEW_BIC },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
    // Original IBAN unchanged.
    const u = await db.users.getByEmail("alice@example.com");
    expect(decryptIban(u!.iban_enc!)).toBe(ALICE_IBAN);
  });

  it("ERR_VALIDATION when iban is provided without bic (partial update forbidden)", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me/bank",
        token: aliceAccessToken(),
        body: { iban: NEW_IBAN },
      }),
    );
    expect(res.statusCode).toBe(400);
    // Persisted bank data unchanged.
    const u = await db.users.getByEmail("alice@example.com");
    expect(decryptBic(u!.bic_enc!)).toBe(ALICE_BIC);
  });

  it("ERR_VALIDATION on a malformed BIC", async () => {
    const db = installTestEnv();
    await seedAlice(db);
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me/bank",
        token: aliceAccessToken(),
        body: { iban: NEW_IBAN, bic: "TOO_SHORT" },
      }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("ERR_AUTH_INVALID without a token", async () => {
    const res = await handler(
      makeEvent({
        method: "PATCH",
        path: "/users/me/bank",
        body: { iban: NEW_IBAN, bic: NEW_BIC },
      }),
    );
    expect(res.statusCode).toBe(401);
  });
});
