// Shared fixtures + helpers across admin-handler test files.

import { hashPassword } from "@railback/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@railback/lib/auth/jwt";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import type { Db } from "@railback/lib/storage/types";
import { seedAdmin as memSeedAdmin, _activeMemState } from "@railback/mocks-in-memory";

import type { ApiGwEvent } from "../src/event.js";

export const ADMIN_EMAIL = "admin@railback.example";
export const ADMIN_PASSWORD = "admin-hunter2";

export const ALICE_EMAIL = "alice@example.com";
export const ALICE_PASSWORD = "hunter2-secret";
export const ALICE_IBAN = "DE89370400440532013000";
export const ALICE_BIC = "COBADEFFXXX";

export const BOB_EMAIL = "bob@example.com";
export const BOB_PASSWORD = "bob-secret-pw";
export const BOB_IBAN = "DE12500105170648489890";
export const BOB_BIC = "INGDDEFFXXX";

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

export function adminAccessToken(email: string = ADMIN_EMAIL): string {
  return signAccessToken({ email, role: "ADMIN" });
}

export function aliceAccessToken(): string {
  return signAccessToken({ email: ALICE_EMAIL, role: "USER" });
}

export function aliceRefreshToken(): string {
  return signRefreshToken({ email: ALICE_EMAIL, role: "USER" });
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

// --- Domain seeding helpers ---------------------------------------------

export interface SeedTicketOverrides {
  ticket_state?: import("@railback/lib/types/enums").TicketState;
  ticket_state_history?: ReadonlyArray<import("@railback/lib/types/enums").TicketState>;
  fahrt_abreisedatum?: string;
  fahrt_abreisebahnhof?: string;
  fahrt_zielbahnhof?: string;
  fahrt_zugnummer_plan?: string;
  fahrt_fahrkartenpreis?: string;
  antragsart?: import("@railback/lib/types/enums").Antragsart;
  antragsgrund?: import("@railback/lib/types/enums").Antragsgrund[];
  delayMinutes?: number;
  erwartete_erstattung?: string;
  service_fee_betrag?: string;
  submitted_at?: string;
  db_paid_at?: string;
  admin_note?: string;
}

export async function seedTicket(
  db: Db,
  email: string,
  ticketId: string,
  overrides: SeedTicketOverrides = {},
): Promise<void> {
  await db.tickets.create({
    email,
    ticketId,
    filename: "ticket.pdf",
    s3_key: `raw/${email}/${ticketId}.pdf`,
    mimeType: "application/pdf",
    contentType: "application/pdf",
    sizeBytes: 1024,
    uploadedAt: new Date().toISOString(),
  });
  await db.ticketOwners.put(ticketId, email);

  // Walk through any explicit history first so state_timeline carries
  // intermediate stamps.
  for (const s of overrides.ticket_state_history ?? []) {
    await db.tickets.patch(email, ticketId, { ticket_state: s });
    await new Promise((r) => setTimeout(r, 2));
  }

  const { ticket_state_history: _hist, ...patch } = overrides;
  void _hist;
  if (Object.keys(patch).length > 0) {
    await db.tickets.patch(email, ticketId, patch);
  }
}

export async function seedMandate(
  db: Db,
  email: string,
  ticketId: string,
  opts: {
    fee_amount?: string;
    pain008_batch_id?: string;
    pain008_s3_key?: string;
    pain008_built_at?: string;
  } = {},
): Promise<void> {
  await db.mandates.issue(email, ticketId, {
    ticketId,
    fee_amount: opts.fee_amount ?? "0.75",
    iban_enc: encryptIban(ALICE_IBAN),
    bic_enc: encryptBic(ALICE_BIC),
    kontoinhaber_snapshot: "Alice Müller",
    user_consent_at: new Date().toISOString(),
  });
  if (opts.pain008_batch_id && opts.pain008_s3_key && opts.pain008_built_at) {
    await db.mandates.stampPain008Built(email, ticketId, {
      batchId: opts.pain008_batch_id,
      s3Key: opts.pain008_s3_key,
      builtAt: opts.pain008_built_at,
    });
  }
}
