// Shared fixtures + helpers across user-handler test files.

import { hashPassword } from "@railback/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@railback/lib/auth/jwt";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import type { Db } from "@railback/lib/storage/types";

import type { ApiGwEvent } from "../src/event.js";

export const ALICE_EMAIL = "alice@example.com";
export const ALICE_PASSWORD = "hunter2-secret";
export const ALICE_IBAN = "DE89370400440532013000";
export const ALICE_BIC = "COBADEFFXXX";

export const aliceProfile = {
  email: ALICE_EMAIL,
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
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

/**
 * Seed Alice directly via the user repo (skip the auth-handler path).
 * Returns the encrypted-blob payload too so individual tests can assert
 * roundtrip behaviour.
 */
export async function seedAlice(db: Db): Promise<void> {
  const hashed_password = await hashPassword(ALICE_PASSWORD);
  await db.users.create({
    ...aliceProfile,
    hashed_password,
    iban_enc: encryptIban(ALICE_IBAN),
    bic_enc: encryptBic(ALICE_BIC),
  });
}

export function aliceAccessToken(): string {
  return signAccessToken({ email: ALICE_EMAIL, role: "USER" });
}

export function aliceRefreshToken(): string {
  return signRefreshToken({ email: ALICE_EMAIL, role: "USER" });
}

export function adminAccessToken(email: string): string {
  return signAccessToken({ email, role: "ADMIN" });
}

export function makeEvent(opts: {
  method: string;
  path: string;
  token?: string;
  body?: unknown;
  pathParameters?: Record<string, string>;
  queryStringParameters?: Record<string, string>;
}): ApiGwEvent {
  const headers: Record<string, string> = {};
  if (opts.token) headers["authorization"] = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const event: ApiGwEvent = {
    version: "2.0",
    headers,
    requestContext: { http: { method: opts.method, path: opts.path } },
  };
  if (opts.body !== undefined) {
    event.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  if (opts.pathParameters !== undefined) {
    event.pathParameters = opts.pathParameters;
  }
  if (opts.queryStringParameters !== undefined) {
    event.queryStringParameters = opts.queryStringParameters;
  }
  return event;
}
