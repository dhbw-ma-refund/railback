// Shared fixtures for anonymisation-sweeper tests. Seeds users, tickets,
// mandates, route-templates, and blobs directly into the in-memory backend.
//
// Two patterns the public Repo API does not support, both reached via the
// `_activeMemState()` escape hatch:
//   - Backdating a user's `ttl` (UserRepo.scheduleDeletion always uses
//     now + 30d; we need expired TTLs).
//   - Setting a mandate's `expires_at` and `mandate_state` to non-default
//     values (MandateRepo.issue always seeds ISSUED + now+36mo).

import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { db } from "@railback/lib/storage";
import { hashPassword } from "@railback/lib/auth/password";
import { emailHash } from "@railback/lib/util/hash";
import { ulid } from "@railback/lib/util/ulid";
import { userPk, USER_PROFILE_SK, mandateSk, ticketSk, normaliseEmail } from "@railback/lib/storage/ddb/keys";

import { _activeMemState } from "@railback/mocks-in-memory";

import type { UserProfileItem, SepaMandateItem } from "@railback/lib/types/items";
import type { MandateState } from "@railback/lib/types/enums";

const TEST_PASSWORD = "swordfish-secret";
const TEST_IBAN = "DE89370400440532013000";
const TEST_BIC = "COBADEFFXXX";

// Module-level test clock seam. Specs that pin a `NOW` should call
// `setTestNow(NOW.getTime())` in beforeEach so seeded ttls / expires_at
// land relative to the sweeper's pinned clock instead of the real
// wall clock (which would otherwise leak the future into the past).
// Defaults to `Date.now()` for any caller that forgets.
let _testNowMs: number | null = null;
export function setTestNow(ms: number | null): void {
  _testNowMs = ms;
}
function _testNow(): number {
  return _testNowMs ?? Date.now();
}

const FAKE_PDF = new Uint8Array(Buffer.from("%PDF-1.4 fake\n%%EOF\n"));
const FAKE_BELEG = new Uint8Array(Buffer.from("fake-receipt-bytes"));
const FAKE_RAW = new Uint8Array(Buffer.from("%PDF-1.4 fake-raw-upload\n%%EOF\n"));

export interface SeedUserOpts {
  email?: string;
  vorname?: string;
  nachname?: string;
}

let _userCounter = 0;
function nextEmail(): string {
  return `user${++_userCounter}@example.com`;
}

async function seedUser(opts: SeedUserOpts = {}): Promise<string> {
  const email = opts.email ?? nextEmail();
  const existing = await db().users.getByEmail(email);
  if (existing) return email;
  await db().users.create({
    email,
    vorname: opts.vorname ?? "Test",
    nachname: opts.nachname ?? "User",
    telefon: "+49 151 9999999",
    adresse: {
      strasse: "Hauptstr.",
      hausnr: "1",
      plz: "60311",
      ort: "Frankfurt",
      land: "DE",
    },
    hashed_password: await hashPassword(TEST_PASSWORD),
    iban_enc: encryptIban(TEST_IBAN),
    bic_enc: encryptBic(TEST_BIC),
    datenschutz_einwilligung: true,
    agb_akzeptiert: true,
  });
  return email;
}

/**
 * Seed a user whose DELETION_SCHEDULED ttl already fired. ttlOffsetSec
 * defaults to -3600 (1h in the past); pass a positive value to seed a
 * not-yet-due user (negative-test).
 */
export interface SeedScheduledForDeletionOpts extends SeedUserOpts {
  /** Offset in seconds from the test "now" for the ttl. Default -3600. */
  ttlOffsetSec?: number;
  /**
   * Base "now" the offset is applied to. Defaults to `Date.now()` so simple
   * tests can pass nothing; tests that pin a `Date` via `_setNow` should
   * pass the same date here so the ttl is consistent with the sweeper's
   * clock.
   */
  nowMs?: number;
}

export async function seedUserScheduledForDeletion(
  opts: SeedScheduledForDeletionOpts = {},
): Promise<{ email: string }> {
  const email = await seedUser(opts);
  await db().users.scheduleDeletion(email);

  // Now back-date the ttl. scheduleDeletion writes now + 30d; we want now +
  // ttlOffsetSec instead. Reach in through _activeMemState — there's no
  // public setter, and patching that into UserRepo just for tests would
  // bloat the production surface.
  const state = _activeMemState();
  if (!state) throw new Error("memory backend not initialised");
  const norm = normaliseEmail(email);
  const bucket = state.rows.get(userPk(norm));
  if (!bucket) throw new Error("user bucket missing after scheduleDeletion");
  const item = bucket.get(USER_PROFILE_SK) as UserProfileItem | undefined;
  if (!item) throw new Error("profile row missing");
  const offset = opts.ttlOffsetSec ?? -3600;
  const nowMs = opts.nowMs ?? _testNow();
  const nowSec = Math.floor(nowMs / 1000);
  const next: UserProfileItem = { ...item, ttl: nowSec + offset };
  bucket.set(USER_PROFILE_SK, next);

  return { email };
}

export async function seedUserActive(opts: SeedUserOpts = {}): Promise<{ email: string }> {
  const email = await seedUser(opts);
  return { email };
}

/**
 * Defensive-case fixture: an ACTIVE user with a backdated ttl. Such a row
 * should never exist in production — TTL is only set by scheduleDeletion
 * which also transitions user_state to DELETION_SCHEDULED — but if it
 * somehow did, the cascade scan MUST skip it (state filter, not just
 * ttl filter). Used to exercise the state-filter half of
 * scanDeletionScheduledExpired.
 */
export async function seedUserActiveWithBackdatedTtl(
  opts: SeedUserOpts & { ttlOffsetSec?: number; nowMs?: number } = {},
): Promise<{ email: string }> {
  const email = await seedUser(opts);
  const state = _activeMemState();
  if (!state) throw new Error("memory backend not initialised");
  const norm = normaliseEmail(email);
  const bucket = state.rows.get(userPk(norm));
  if (!bucket) throw new Error("user bucket missing");
  const item = bucket.get(USER_PROFILE_SK) as UserProfileItem | undefined;
  if (!item) throw new Error("profile row missing");
  const offset = opts.ttlOffsetSec ?? -3600;
  const nowMs = opts.nowMs ?? _testNow();
  const nowSec = Math.floor(nowMs / 1000);
  bucket.set(USER_PROFILE_SK, { ...item, ttl: nowSec + offset });
  return { email };
}

export interface SeedTicketWithBlobsOpts {
  email: string;
  ticketId?: string;
  /** Skip the rendered-PDF row + bytes. Default false (rendered seeded). */
  noRenderedPdf?: boolean;
  /** Skip the raw-upload row + bytes. Default false (raw seeded). */
  noRawUpload?: boolean;
  /** How many belege to seed. Default 1. */
  belegeCount?: number;
  /** Skip the TicketOwner mapping row. Default false (owner seeded). */
  noTicketOwner?: boolean;
  /**
   * Seed email-pipeline retry-queue keys (GSI_EMAIL_PENDING_PK/_SK +
   * email_status="FAILED_TRANSIENT" + email_attempts=1 + email_last_attempt).
   * Used to assert the cascade clears them so the anonymised row never
   * re-enters the email-sweeper retry queue.
   */
  seedEmailPending?: boolean;
}

export interface SeededTicket {
  email: string;
  ticketId: string;
  belegIds: string[];
}

export async function seedTicketWithBlobs(
  opts: SeedTicketWithBlobsOpts,
): Promise<SeededTicket> {
  const ticketId = opts.ticketId ?? ulid();
  await db().tickets.createFromRoute({
    email: opts.email,
    ticketId,
    trainNr: "ICE517",
    date: "2026-06-01",
    fromStation: "Frankfurt (Main) Hbf",
    fromEva: 8000105,
    toStation: "Berlin Hbf",
    toEva: 8011160,
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "12:00",
    fahrkartennummer: "9876543210",
    fahrkartenpreis: "120.00",
    is_zeitkarte: false,
  });

  // PII fields the cascade should strip — patch them onto the ticket so
  // we can assert they're gone after anonymisation. vorname_aus_ticket /
  // nachname_aus_ticket are the two most-obvious PII columns; they normally
  // come from barcode extraction (BARCODE method) but createFromRoute
  // doesn't set them, so we seed them explicitly here.
  await db().tickets.patch(opts.email, ticketId, {
    vorname_aus_ticket: "Alice",
    nachname_aus_ticket: "Wonder",
    antragstellung_ort: "Frankfurt",
    antragstellung_datum: "2026-06-15",
    zusaetzliche_angaben: "ein freitextfeld",
  });

  // Optionally seed the email retry-queue GSI keys so we can verify the
  // anonymise call clears them (cross-Lambda safety — anonymised rows
  // must not re-enter the email-sweeper queue).
  if (opts.seedEmailPending) {
    const state = _activeMemState();
    if (!state) throw new Error("memory backend not initialised");
    const bucket = state.rows.get(userPk(normaliseEmail(opts.email)));
    if (!bucket) throw new Error("user bucket missing");
    const sk = ticketSk(ticketId);
    const item = bucket.get(sk) as Record<string, unknown> | undefined;
    if (!item) throw new Error("ticket row missing");
    bucket.set(sk, {
      ...item,
      ticket_state: "EMAIL_SENDING",
      email_status: "FAILED_TRANSIENT",
      email_attempts: 1,
      email_last_attempt: "2026-06-20T10:00:00.000Z",
      GSI_EMAIL_PENDING_PK: "EMAIL_PENDING",
      GSI_EMAIL_PENDING_SK: "ATTEMPT#2026-06-20T10:00:00.000Z",
    });
  }

  const now = new Date().toISOString();
  const eh = emailHash(opts.email);

  if (!opts.noRawUpload) {
    const s3_key = `raw/${eh}/${ticketId}.pdf`;
    await db().blobs.putBytes(s3_key, FAKE_RAW, "application/pdf", now);
    await db().blobs.putRawUpload(opts.email, ticketId, {
      filename: `ticket-${ticketId}.pdf`,
      s3_bucket: "memory-mock",
      s3_key,
      size_bytes: FAKE_RAW.byteLength,
      content_type: "application/pdf",
      uploaded_at: now,
    });
  }

  if (!opts.noRenderedPdf) {
    const s3_key = `rendered/${eh}/${ticketId}.pdf`;
    await db().blobs.putBytes(s3_key, FAKE_PDF, "application/pdf", now);
    await db().blobs.putRenderedPdf(opts.email, ticketId, {
      s3_bucket: "memory-mock",
      s3_key,
      size_bytes: FAKE_PDF.byteLength,
      rendered_at: now,
    });
  }

  const belegeCount = opts.belegeCount ?? 1;
  const belegIds: string[] = [];
  for (let i = 0; i < belegeCount; i++) {
    const belegId = ulid();
    belegIds.push(belegId);
    const s3_key = `belege/${eh}/${ticketId}/${belegId}.jpg`;
    await db().blobs.putBytes(s3_key, FAKE_BELEG, "image/jpeg", now);
    await db().blobs.putReceipt(opts.email, ticketId, {
      belegId,
      filename: `beleg-${i}.jpg`,
      s3_bucket: "memory-mock",
      s3_key,
      content_type: "image/jpeg",
      size_bytes: FAKE_BELEG.byteLength,
      typ: "TAXI",
      amount: "12.50",
      uploaded_at: now,
    });
  }

  if (!opts.noTicketOwner) {
    await db().ticketOwners.put(ticketId, opts.email);
  }

  return { email: opts.email, ticketId, belegIds };
}

export interface SeedMandateOpts {
  email: string;
  ticketId: string;
  /** Mandate state override. Default ISSUED. */
  state?: MandateState;
  /** expires_at offset in seconds from the test "now". Default +1y. */
  expiresAtOffsetSec?: number;
  /** Base "now" the offset is applied to. Default Date.now(). */
  nowMs?: number;
  /**
   * Seed audit-trail bookkeeping fields the cascade MUST preserve
   * (DB_SCHEMA.md §"Cascade on user delete" item 4 + HGB-retention
   * carve-out). Useful for the cascade's keep-list assertions.
   */
  seedAuditTrail?: boolean;
}

export interface MandateAuditFixture {
  pain008_built_at: string;
  pain008_batch_id: string;
  pain008_s3_key: string;
  pain008_submitted_at: string;
  debited_at: string;
  vorabankuendigung_sent_at: string;
}

export const MANDATE_AUDIT_FIXTURE: MandateAuditFixture = {
  pain008_built_at: "2026-05-01T08:00:00.000Z",
  pain008_batch_id: "BATCH-TEST-001",
  pain008_s3_key: "pain008/2026-05-01/BATCH-TEST-001.xml",
  pain008_submitted_at: "2026-05-01T10:00:00.000Z",
  debited_at: "2026-05-03T00:00:00.000Z",
  vorabankuendigung_sent_at: "2026-04-30T12:00:00.000Z",
};

export async function seedMandate(opts: SeedMandateOpts): Promise<void> {
  await db().mandates.issue(opts.email, opts.ticketId, {
    ticketId: opts.ticketId,
    fee_amount: "0.75",
    iban_enc: encryptIban(TEST_IBAN),
    bic_enc: encryptBic(TEST_BIC),
    kontoinhaber_snapshot: "Test User",
    user_consent_at: new Date().toISOString(),
    user_consent_ip: "127.0.0.1",
    user_consent_user_agent: "vitest",
  });

  // Override state / expires_at + optional audit-trail fields by reaching
  // into the raw row.
  const state = _activeMemState();
  if (!state) throw new Error("memory backend not initialised");
  const norm = normaliseEmail(opts.email);
  const bucket = state.rows.get(userPk(norm));
  if (!bucket) throw new Error("user bucket missing");
  const sk = mandateSk(opts.ticketId);
  const item = bucket.get(sk) as SepaMandateItem | undefined;
  if (!item) throw new Error("mandate row missing");
  const offset = opts.expiresAtOffsetSec ?? 365 * 24 * 3600;
  const nowMs = opts.nowMs ?? _testNow();
  const expiresIso = new Date(nowMs + offset * 1000).toISOString();
  const next: SepaMandateItem = {
    ...item,
    mandate_state: opts.state ?? "ISSUED",
    expires_at: expiresIso,
  };
  if (opts.seedAuditTrail) {
    next.pain008_built_at = MANDATE_AUDIT_FIXTURE.pain008_built_at;
    next.pain008_batch_id = MANDATE_AUDIT_FIXTURE.pain008_batch_id;
    next.pain008_s3_key = MANDATE_AUDIT_FIXTURE.pain008_s3_key;
    next.pain008_submitted_at = MANDATE_AUDIT_FIXTURE.pain008_submitted_at;
    next.debited_at = MANDATE_AUDIT_FIXTURE.debited_at;
    next.vorabankuendigung_sent_at = MANDATE_AUDIT_FIXTURE.vorabankuendigung_sent_at;
  }
  bucket.set(sk, next);
}

export async function seedRouteTemplate(
  email: string,
  templateId?: string,
): Promise<{ templateId: string }> {
  const id = templateId ?? ulid();
  await db().routeTemplates.create(email, {
    templateId: id,
    label: "Frankfurt → Berlin",
    from_station: "Frankfurt (Main) Hbf",
    from_eva: 8000105,
    to_station: "Berlin Hbf",
    to_eva: 8011160,
    fahrkartennummer: "9876543210",
    fahrkartenpreis: "120.00",
  });
  return { templateId: id };
}

/** Read the raw bucket count under a PK — assert helper. */
export function countRowsUnderPk(pk: string): number {
  const state = _activeMemState();
  if (!state) return 0;
  const bucket = state.rows.get(pk);
  return bucket ? bucket.size : 0;
}

/** Read a raw row under (pk, sk) — assert helper. */
export function getRawRow<T = unknown>(pk: string, sk: string): T | null {
  const state = _activeMemState();
  if (!state) return null;
  const bucket = state.rows.get(pk);
  if (!bucket) return null;
  const v = bucket.get(sk);
  return (v ?? null) as T | null;
}

/** Check whether a blob exists at the given key. */
export function blobExists(key: string): boolean {
  const state = _activeMemState();
  if (!state) return false;
  for (const [, bucket] of state.blobs) {
    if (bucket.has(key)) return true;
  }
  return false;
}
