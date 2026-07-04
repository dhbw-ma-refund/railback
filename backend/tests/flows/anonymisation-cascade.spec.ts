// anonymisation-cascade.spec.ts — Phase 4 cross-Lambda flow spec.
//
// Exercises the anonymisation-sweeper cron end-to-end against fixtures
// produced by the real user-handler + refund-pdf pipeline (self-delete
// path, ISSUED-mandate expiry, orphan-PK recovery). Deliberately keeps
// blob/pk manipulation via the `_activeMemState()` backdoor because there
// is no public API for either (backdate ttl, hard-delete PROFILE while
// leaving child rows).

import { afterEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { sha256Hex, emailHash } from "@railback/lib/util/hash";
import {
  USER_PROFILE_SK,
  mandateSk,
  normaliseEmail,
  ticketSk,
  userPk,
} from "@railback/lib/storage/ddb/keys";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import { ulid } from "@railback/lib/util/ulid";

import { _activeMemState } from "@railback/mocks-in-memory";

import { _setNow, handler as sweeperHandler } from "@railback/anonymisation-sweeper";
import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";

import {
  ALICE_EMAIL,
  ALICE_BIC,
  ALICE_IBAN,
  ALICE_PASSWORD,
  aliceAccessToken,
  makeEvent,
  seedAlice,
} from "../shared/fixtures.js";
import { installTestEnv, teardownTestEnv } from "../shared/env.js";

// Fixed clock the sweeper honours via `_setNow`. Same instant is passed
// into every backdated ttl / expires_at so seeded rows are consistent
// with the sweeper's view of "now".
const NOW = new Date("2026-06-26T12:00:00.000Z");

const TRAIN_NR = "ICE 517";
const DATE = "2026-06-01";
const REFUND_BODY = {
  antragsgrund: ["VERSPAETUNG"],
  antragsart: "ENTSCHAEDIGUNG_60_119",
  fahrt: {
    abreisedatum: DATE,
    abreisebahnhof: "Frankfurt (Main) Hbf",
    zielbahnhof: "Berlin Hauptbahnhof",
    abfahrtszeit_plan: "08:00",
    ankunftszeit_plan: "12:00",
    zugnummer_plan: TRAIN_NR,
    fahrkartennummer: "9876543210",
    fahrkartenpreis: "120.00",
  },
  fahrt_tatsaechlich: {
    ankunftsdatum_tatsaechlich: DATE,
    ankunftszeit_tatsaechlich: "13:30", // +90 min → 60-119 bucket
    zugnummer_tatsaechlich: TRAIN_NR,
  },
  antragstellung_ort: "Frankfurt",
  datenschutz_einwilligung: true,
  wahrheitserklaerung: true,
};

/**
 * Drives the real user-handler routes to land a ticket in EMAIL_SENDING
 * with a rendered PDF in S3 + an ISSUED mandate row. Mirrors the
 * happy-path flow exercised by lambdas/user-handler/test/post-refund.spec.ts.
 */
async function submitRefundAsAlice(): Promise<string> {
  const ticketId = ulid();

  // 1. POST /users/me/tickets/from-route → creates the ticket in READY.
  //    Real extractor runs in Python; the route-template flow bypasses it,
  //    so no extractor simulation is needed here.
  const fromRoute = await userHandler(
    makeEvent({
      method: "POST",
      path: "/users/me/tickets/from-route",
      token: aliceAccessToken(),
      body: {
        ticketId,
        trainNr: TRAIN_NR,
        date: DATE,
        fromStation: "Frankfurt (Main) Hbf",
        toStation: "Berlin Hauptbahnhof",
        abfahrtszeit_plan: "08:00",
        ankunftszeit_plan: "12:00",
        fahrkartennummer: "9876543210",
        fahrkartenpreis: "120.00",
        is_zeitkarte: false,
      },
    }),
  );
  expect(fromRoute.statusCode).toBe(201);

  // 2. POST /users/me/tickets/{id}/refund → locks amounts, issues mandate,
  //    invokes refund-pdf which renders + puts rendered PDF into S3.
  const refund = await userHandler(
    makeEvent({
      method: "POST",
      path: `/users/me/tickets/${ticketId}/refund`,
      token: aliceAccessToken(),
      pathParameters: { ticketId },
      body: REFUND_BODY,
    }),
  );
  expect(refund.statusCode).toBe(202);
  return ticketId;
}

/** Reach into the mem-state and rewrite Alice's PROFILE ttl to (nowMs - offsetSec). */
function backdateProfileTtl(email: string, offsetSecFromNow: number): void {
  const state = _activeMemState();
  if (!state) throw new Error("no active mem state");
  const bucket = state.rows.get(userPk(normaliseEmail(email)));
  if (!bucket) throw new Error("user bucket missing");
  const profile = bucket.get(USER_PROFILE_SK) as Record<string, unknown> | undefined;
  if (!profile) throw new Error("profile row missing");
  const nowSec = Math.floor(NOW.getTime() / 1000);
  bucket.set(USER_PROFILE_SK, { ...profile, ttl: nowSec + offsetSecFromNow });
}

/** Hard-delete the PROFILE row under a live PK (simulates DDB TTL sweeper). */
function hardDeleteProfile(email: string): void {
  const state = _activeMemState();
  if (!state) throw new Error("no active mem state");
  const bucket = state.rows.get(userPk(normaliseEmail(email)));
  if (!bucket) throw new Error("user bucket missing");
  bucket.delete(USER_PROFILE_SK);
}

/** Backdate a mandate's `expires_at` to (NOW - offsetSec). */
function backdateMandateExpiry(email: string, ticketId: string, offsetSecFromNow: number): void {
  const state = _activeMemState();
  if (!state) throw new Error("no active mem state");
  const bucket = state.rows.get(userPk(normaliseEmail(email)));
  if (!bucket) throw new Error("user bucket missing");
  const sk = mandateSk(ticketId);
  const item = bucket.get(sk) as Record<string, unknown> | undefined;
  if (!item) throw new Error("mandate row missing");
  const expires = new Date(NOW.getTime() + offsetSecFromNow * 1000).toISOString();
  bucket.set(sk, { ...item, expires_at: expires });
}

/** Directly probe blob bytes at s3_key (blobs.getBytes wraps the same map). */
async function blobExists(s3Key: string): Promise<boolean> {
  const bytes = await db().blobs.getBytes(s3Key);
  return bytes !== null;
}

describe("anonymisation cascade — cross-Lambda flow", () => {
  afterEach(() => {
    _setNow(null);
    vi.useRealTimers();
    teardownTestEnv();
  });

  it("self-delete → cron cascade anonymises tickets + mandates + rendered PDF", async () => {
    const dbi = installTestEnv();
    _setNow(() => NOW);
    // Pin wall-clock to NOW so submitted_at / mandate.issued_at /
    // mandate.expires_at etc. — which the real user-handler + refund-pdf
    // pipeline stamp via `new Date().toISOString()` — land in the sweeper's
    // logical `now` frame instead of drifting off the real system clock.
    // `shouldAdvanceTime: true` keeps async waits realistic (setTimeout /
    // setImmediate still fire) so scrypt password verification isn't stalled.
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    await seedAlice(dbi);

    // Drive the user-handler flow so the ticket + rendered PDF + mandate
    // are produced by the same code paths production runs.
    const ticketId = await submitRefundAsAlice();

    // Pre-cascade sanity: rendered PDF sits at rendered/<emailHash>/<id>.pdf.
    const eh = emailHash(ALICE_EMAIL);
    const renderedKey = `rendered/${eh}/${ticketId}.pdf`;
    expect(await blobExists(renderedKey)).toBe(true);

    // Stub a pain008 audit-XML row on the mandate so we can prove HGB
    // retention wins over DSGVO erasure. In production this is written
    // by pain008-generator on APPROVED — we short-circuit it because
    // the flow under test only covers the self-delete path (no admin
    // approval), and we still want to assert the audit-XML survives.
    const pain008Key = `pain008/2026-06/${ticketId}.xml`;
    const pain008Bytes = new Uint8Array(Buffer.from("<Document/>"));
    await dbi.blobs.putBytes(pain008Key, pain008Bytes, "application/xml", NOW.toISOString());
    // Snapshot the audit-XML key onto the mandate row so the cascade's
    // preserved-column contract is testable.
    {
      const state = _activeMemState();
      if (!state) throw new Error("no active mem state");
      const bucket = state.rows.get(userPk(normaliseEmail(ALICE_EMAIL)));
      if (!bucket) throw new Error("user bucket missing");
      const mSk = mandateSk(ticketId);
      const m = bucket.get(mSk) as Record<string, unknown> | undefined;
      if (!m) throw new Error("mandate missing");
      bucket.set(mSk, {
        ...m,
        pain008_s3_key: pain008Key,
        pain008_batch_id: "BATCH-FLOW-001",
        pain008_built_at: "2026-06-25T10:00:00.000Z",
      });
    }

    // DELETE /users/me — schedules deletion (ttl = now + 30d).
    const del = await userHandler(
      makeEvent({
        method: "DELETE",
        path: "/users/me",
        token: aliceAccessToken(),
        body: { confirmPassword: ALICE_PASSWORD },
      }),
    );
    expect(del.statusCode).toBe(204);

    // Backdate the ttl to 1h before NOW so the cascade scan picks it up.
    backdateProfileTtl(ALICE_EMAIL, -3600);
    // And confirm the state row is DELETION_SCHEDULED.
    const profileNow = await dbi.users.getByEmailForAuth(ALICE_EMAIL);
    expect(profileNow?.user_state).toBe("DELETION_SCHEDULED");

    // Invoke the cron.
    const result = await sweeperHandler();
    expect(result.cascaded_users).toBeGreaterThanOrEqual(1);
    expect(result.anonymised_tickets).toBeGreaterThanOrEqual(1);
    expect(result.anonymised_mandates).toBeGreaterThanOrEqual(1);

    // Profile is gone under the live PK.
    const liveBucket = _activeMemState()!.rows.get(userPk(normaliseEmail(ALICE_EMAIL)));
    // Either the whole bucket was cleaned out or at least PROFILE is absent.
    if (liveBucket) expect(liveBucket.has(USER_PROFILE_SK)).toBe(false);

    // Ticket row was rewritten to the anonymised PK.
    const anonPk = `USER#sha256:${sha256Hex(normaliseEmail(ALICE_EMAIL))}`;
    expect(anonPk.startsWith("USER#sha256:")).toBe(true);
    const anonBucket = _activeMemState()!.rows.get(anonPk);
    expect(anonBucket).toBeDefined();
    const anonTicket = anonBucket!.get(ticketSk(ticketId)) as Record<string, unknown> | undefined;
    expect(anonTicket).toBeDefined();
    expect(anonTicket!.ticketId).toBe(ticketId);
    // PII stripped.
    expect(anonTicket!.vorname).toBeUndefined();
    expect(anonTicket!.nachname).toBeUndefined();
    // Bookkeeping preserved.
    expect(anonTicket!.erwartete_erstattung).toBe("30.00"); // 0.25 * 120.00
    expect(anonTicket!.service_fee_betrag).toBe("0.75");

    // Rendered PDF S3 bytes hard-deleted.
    expect(await blobExists(renderedKey)).toBe(false);

    // pain008 audit-XML survives — HGB retention overrides DSGVO.
    expect(await blobExists(pain008Key)).toBe(true);
    // Mandate row also preserves the audit-XML key column.
    const anonMandate = anonBucket!.get(mandateSk(ticketId)) as Record<string, unknown> | undefined;
    expect(anonMandate).toBeDefined();
    expect(anonMandate!.pain008_s3_key).toBe(pain008Key);
    // IBAN/BIC stripped from the anonymised mandate.
    expect(anonMandate!.iban_enc).toBeUndefined();
    expect(anonMandate!.bic_enc).toBeUndefined();
  });

  it("Pass B — ISSUED mandate past expires_at → EXPIRED + service_fee_state=WAIVED", async () => {
    const dbi = installTestEnv();
    _setNow(() => NOW);
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    await seedAlice(dbi);

    // Real user-handler flow to get a ticket in EMAIL_SENDING + an
    // ISSUED mandate with fee_amount=0.75.
    const ticketId = await submitRefundAsAlice();

    // Backdate the mandate's expires_at to 1s before NOW so Pass B fires.
    backdateMandateExpiry(ALICE_EMAIL, ticketId, -1);

    const result = await sweeperHandler();
    expect(result.expired_mandates).toBeGreaterThanOrEqual(1);
    expect(result.cascaded_users).toBe(0); // Alice is still ACTIVE

    const m = await dbi.mandates.get(ALICE_EMAIL, ticketId);
    expect(m).not.toBeNull();
    expect(m!.mandate_state).toBe("EXPIRED");
    expect(m!.fee_amount).toBe("0.75");

    const t = await dbi.tickets.get(ALICE_EMAIL, ticketId);
    expect(t?.service_fee_state).toBe("WAIVED");
  });

  it("orphan user PK — PROFILE evicted before cron → Pass A recovery cascades child rows", async () => {
    const dbi = installTestEnv();
    _setNow(() => NOW);
    await seedAlice(dbi);

    // Seed the ticket + mandate + rendered-PDF directly (no user-handler
    // flow needed — this test is about orphan-PK recovery, not the
    // happy-path submit). Real extractor runs in Python; this simulates
    // its persist step by putting the row straight into READY via the
    // route-template repo.
    const ticketId = ulid();
    await dbi.tickets.createFromRoute({
      email: ALICE_EMAIL,
      ticketId,
      trainNr: TRAIN_NR,
      date: DATE,
      fromStation: "Frankfurt (Main) Hbf",
      fromEva: 8000105,
      toStation: "Berlin Hauptbahnhof",
      toEva: 8011160,
      abfahrtszeit_plan: "08:00",
      ankunftszeit_plan: "12:00",
      fahrkartennummer: "9876543210",
      fahrkartenpreis: "120.00",
      is_zeitkarte: false,
    });
    await dbi.ticketOwners.put(ticketId, ALICE_EMAIL);
    await dbi.mandates.issue(ALICE_EMAIL, ticketId, {
      ticketId,
      fee_amount: "0.75",
      iban_enc: encryptIban(ALICE_IBAN),
      bic_enc: encryptBic(ALICE_BIC),
      kontoinhaber_snapshot: "Alice Müller",
      user_consent_at: NOW.toISOString(),
      user_consent_ip: "127.0.0.1",
      user_consent_user_agent: "vitest",
    });
    // Rendered PDF blob + metadata row.
    const eh = emailHash(ALICE_EMAIL);
    const renderedKey = `rendered/${eh}/${ticketId}.pdf`;
    const renderedBytes = new Uint8Array(Buffer.from("%PDF-1.4 fake\n%%EOF\n"));
    await dbi.blobs.putBytes(renderedKey, renderedBytes, "application/pdf", NOW.toISOString());
    await dbi.blobs.putRenderedPdf(ALICE_EMAIL, ticketId, {
      s3_bucket: "memory-mock",
      s3_key: renderedKey,
      size_bytes: renderedBytes.byteLength,
      rendered_at: NOW.toISOString(),
    });

    // Simulate DDB's TTL sweeper eating Alice's PROFILE row before our
    // cron ran. Child rows remain stranded under USER#<alice>.
    hardDeleteProfile(ALICE_EMAIL);
    expect(await dbi.users.getByEmailForAuth(ALICE_EMAIL)).toBeNull();

    // Cron runs. Pass A's orphan-recovery second loop must pick up the
    // stranded child rows and cascade them.
    const result = await sweeperHandler();
    expect(result.cascaded_users).toBeGreaterThanOrEqual(1);
    expect(result.anonymised_tickets).toBeGreaterThanOrEqual(1);
    expect(result.anonymised_mandates).toBeGreaterThanOrEqual(1);

    // Ticket row now lives under the anonymised PK, not the original.
    const anonPk = `USER#sha256:${sha256Hex(normaliseEmail(ALICE_EMAIL))}`;
    const anonBucket = _activeMemState()!.rows.get(anonPk);
    expect(anonBucket).toBeDefined();
    const anonTicket = anonBucket!.get(ticketSk(ticketId));
    expect(anonTicket).toBeDefined();
    // Rendered PDF hard-deleted.
    expect(await blobExists(renderedKey)).toBe(false);
    // Live-PK bucket is either gone or drained of the ticket / mandate rows.
    const liveBucket = _activeMemState()!.rows.get(userPk(normaliseEmail(ALICE_EMAIL)));
    if (liveBucket) {
      expect(liveBucket.has(ticketSk(ticketId))).toBe(false);
      expect(liveBucket.has(mandateSk(ticketId))).toBe(false);
    }
  });
});
