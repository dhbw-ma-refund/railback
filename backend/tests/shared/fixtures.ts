// Cross-cutting fixtures for cross-Lambda flow specs. Copies the
// user + admin seeding helpers from lambdas/user-handler/test/fixtures.ts
// and lambdas/admin-handler/test/fixtures.ts so flow specs don't have to
// reach into any single lambda's test folder. The API Gateway v2 event
// shape is duplicated locally (matches every lambda's src/event.ts
// definition) so we stay lambda-agnostic.

import { hashPassword } from "@railback/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@railback/lib/auth/jwt";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import type { Db } from "@railback/lib/storage/types";
import { seedAdmin as memSeedAdmin, _activeMemState } from "@railback/mocks-in-memory";

// --- Constants ----------------------------------------------------------

export const ALICE_EMAIL = "alice@example.com";
export const ALICE_PASSWORD = "hunter2-secret";
export const ALICE_IBAN = "DE89370400440532013000";
export const ALICE_BIC = "COBADEFFXXX";

export const BOB_EMAIL = "bob@example.com";
export const BOB_PASSWORD = "bob-secret-pw";
export const BOB_IBAN = "DE12500105170648489890";
export const BOB_BIC = "INGDDEFFXXX";

export const ADMIN_EMAIL = "admin@railback.example";
export const ADMIN_PASSWORD = "admin-hunter2";

// --- Profiles -----------------------------------------------------------

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

export const bobProfile = {
  email: BOB_EMAIL,
  vorname: "Bob",
  nachname: "Schmidt",
  telefon: "+49 160 7654321",
  adresse: {
    strasse: "Hauptstr.",
    hausnr: "5",
    plz: "20095",
    ort: "Hamburg",
    land: "DE",
  },
  datenschutz_einwilligung: true,
  agb_akzeptiert: true,
};

// --- Seeders ------------------------------------------------------------

export async function seedAlice(db: Db): Promise<void> {
  const hashed = await hashPassword(ALICE_PASSWORD);
  await db.users.create({
    ...aliceProfile,
    hashed_password: hashed,
    iban_enc: encryptIban(ALICE_IBAN),
    bic_enc: encryptBic(ALICE_BIC),
  });
}

export async function seedBob(db: Db): Promise<void> {
  const hashed = await hashPassword(BOB_PASSWORD);
  await db.users.create({
    ...bobProfile,
    hashed_password: hashed,
    iban_enc: encryptIban(BOB_IBAN),
    bic_enc: encryptBic(BOB_BIC),
  });
}

export async function seedAdmin(): Promise<void> {
  const state = _activeMemState();
  if (!state) throw new Error("no active mem state — call installTestEnv first");
  const hashed = await hashPassword(ADMIN_PASSWORD);
  memSeedAdmin(state, ADMIN_EMAIL, hashed);
}

// --- JWT factories ------------------------------------------------------

export function aliceAccessToken(): string {
  return signAccessToken({ email: ALICE_EMAIL, role: "USER" });
}

export function aliceRefreshToken(): string {
  return signRefreshToken({ email: ALICE_EMAIL, role: "USER" });
}

export function bobAccessToken(): string {
  return signAccessToken({ email: BOB_EMAIL, role: "USER" });
}

export function adminAccessToken(email: string = ADMIN_EMAIL): string {
  return signAccessToken({ email, role: "ADMIN" });
}

// --- API Gateway v2 event builder --------------------------------------

/**
 * Structurally-compatible subset of the API GW v2 event every lambda's
 * src/event.ts declares. Kept local so no flow spec has to pick a specific
 * lambda's event module — TypeScript structural typing lets the same object
 * feed into any handler.
 */
export interface ApiGwEvent {
  version: "2.0";
  headers: Record<string, string | undefined>;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
  body?: string;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
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
