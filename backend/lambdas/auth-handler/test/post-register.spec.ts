import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptIban, decryptBic } from "@railback/lib/crypto/iban";
import { verifyAccessToken, verifyRefreshToken } from "@railback/lib/auth/jwt";

import { installTestEnv, teardownTestEnv } from "./setup.js";
import { handler } from "../src/handler.js";

function makeEvent(body: unknown) {
  return {
    version: "2.0" as const,
    headers: {},
    requestContext: { http: { method: "POST", path: "/auth/register" } },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

const validBody = {
  email: "Maria.Mueller@Example.de",
  password: "min-8-zeichen",
  vorname: "Maria",
  nachname: "Müller",
  telefon: "+49 151 1234567",
  adresse: {
    strasse: "Musterstraße",
    hausnr: "12a",
    plz: "68161",
    ort: "Mannheim",
    land: "DE",
  },
  iban: "DE89 3704 0044 0532 0130 00",
  bic: "COBADEFFXXX",
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

describe("POST /auth/register", () => {
  beforeEach(() => {
    installTestEnv();
  });
  afterEach(() => {
    teardownTestEnv();
  });

  it("creates a user, encrypts iban/bic, returns 201 + tokens", async () => {
    const db = installTestEnv();
    const res = await handler(makeEvent(validBody));
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.accessToken).toBeTypeOf("string");
    expect(body.refreshToken).toBeTypeOf("string");
    expect(body.expiresIn).toBe(900);
    expect(body.user).toEqual({
      email: "maria.mueller@example.de",
      vorname: "Maria",
      nachname: "Müller",
      role: "USER",
    });

    // Token round-trips
    const claims = verifyAccessToken(body.accessToken);
    expect(claims.sub).toBe("maria.mueller@example.de");
    expect(claims.role).toBe("USER");
    const rclaims = verifyRefreshToken(body.refreshToken);
    expect(rclaims.role).toBe("USER");

    // User exists in DB with encrypted iban/bic
    const u = await db.users.getByEmail("maria.mueller@example.de");
    expect(u).not.toBeNull();
    expect(u?.user_state).toBe("ACTIVE");
    expect(u?.iban_enc).toBeTypeOf("string");
    expect(u?.bic_enc).toBeTypeOf("string");
    expect(decryptIban(u!.iban_enc!)).toBe("DE89370400440532013000");
    expect(decryptBic(u!.bic_enc!)).toBe("COBADEFFXXX");
  });

  it("rejects when consent literals are not true", async () => {
    const res = await handler(
      makeEvent({ ...validBody, datenschutz_einwilligung: false }),
    );
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("ERR_VALIDATION");
  });

  it("rejects when iban is missing (now mandatory)", async () => {
    const { iban, ...rest } = validBody;
    void iban;
    const res = await handler(makeEvent(rest));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe("ERR_VALIDATION");
  });

  it("rejects when password is too short", async () => {
    const res = await handler(makeEvent({ ...validBody, password: "short" }));
    expect(res.statusCode).toBe(400);
  });

  it("rejects when email is already registered (ERR_CONFLICT)", async () => {
    const ok = await handler(makeEvent(validBody));
    expect(ok.statusCode).toBe(201);
    const dup = await handler(makeEvent(validBody));
    expect(dup.statusCode).toBe(409);
    expect(JSON.parse(dup.body).error.code).toBe("ERR_CONFLICT");
  });

  it("rejects when body is malformed JSON", async () => {
    const res = await handler({
      version: "2.0" as const,
      headers: {},
      requestContext: { http: { method: "POST", path: "/auth/register" } },
      body: "{ not valid json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("normalises iban whitespace + email casing before persistence", async () => {
    const db = installTestEnv();
    await handler(makeEvent(validBody));
    const u = await db.users.getByEmail("MARIA.MUELLER@example.de");
    expect(u?.email).toBe("maria.mueller@example.de");
    expect(decryptIban(u!.iban_enc!)).toBe("DE89370400440532013000");
  });
});
