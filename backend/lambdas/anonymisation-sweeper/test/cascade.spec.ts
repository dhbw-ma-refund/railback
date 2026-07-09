// cascade.spec.ts — Pass A coverage.
//
// Asserts the GDPR cascade anonymises tickets/mandates (PK rewrite + PII
// strip), hard-deletes templates/blobs/owner-mappings/profile, leaves
// unrelated users alone, and isolates per-user failures.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@railback/lib/storage";
import { emailHash, sha256Hex } from "@railback/lib/util/hash";
import { normaliseEmail, userPk, mandateSk, ticketSk, USER_PROFILE_SK } from "@railback/lib/storage/ddb/keys";

import { runCascadePass } from "../src/cascade.js";
import { installTestEnv, teardownTestEnv } from "./setup.js";
import {
  blobExists,
  countRowsUnderPk,
  getRawRow,
  MANDATE_AUDIT_FIXTURE,
  seedMandate,
  seedRouteTemplate,
  seedTicketWithBlobs,
  seedUserActive,
  seedUserActiveWithBackdatedTtl,
  seedUserScheduledForDeletion,
  setTestNow,
} from "./fixtures.js";

const NOW = new Date("2026-06-26T12:00:00.000Z");

function anonPkFor(email: string): string {
  return `USER#sha256:${sha256Hex(normaliseEmail(email))}`;
}

describe("runCascadePass", () => {
  beforeEach(() => {
    installTestEnv();
    setTestNow(NOW.getTime());
  });
  afterEach(() => {
    setTestNow(null);
    teardownTestEnv();
  });

  it("happy path: user with all 6 child-row types is anonymised + hard-deleted correctly", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "alice@example.com" });
    const { ticketId, belegIds } = await seedTicketWithBlobs({ email, belegeCount: 2 });
    await seedMandate({ email, ticketId, seedAuditTrail: true });
    await seedRouteTemplate(email);
    await seedRouteTemplate(email);

    const liveBefore = countRowsUnderPk(userPk(normaliseEmail(email)));
    expect(liveBefore).toBeGreaterThan(0);

    // Snapshot the pre-cascade ticket so we can confirm anonymisation
    // actually rewrote updated_at (vs. the new value happening to equal
    // the seed's value).
    const liveTicketBefore = getRawRow<Record<string, unknown>>(
      userPk(normaliseEmail(email)),
      ticketSk(ticketId),
    );
    expect(liveTicketBefore).not.toBeNull();
    expect(liveTicketBefore!.updated_at).not.toBe(NOW.toISOString());

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(1);
    expect(result.anonymised_mandates).toBe(1);
    expect(result.deleted_templates).toBe(2);
    // 1 raw + 1 rendered + 2 belege
    expect(result.deleted_blobs).toBe(4);

    // Profile, templates, raw, rendered, belege, owner are all gone from live PK.
    expect(getRawRow(userPk(normaliseEmail(email)), USER_PROFILE_SK)).toBeNull();
    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(0);

    // Anonymised PK has the ticket + mandate.
    const anon = anonPkFor(email);
    const anonTicket = getRawRow<Record<string, unknown>>(anon, ticketSk(ticketId));
    expect(anonTicket).not.toBeNull();
    expect(anonTicket!.PK).toBe(anon);

    // ── PII strip (must be undefined post-cascade) ──
    // vorname_aus_ticket / nachname_aus_ticket were explicitly populated
    // by seedTicketWithBlobs precisely so these assertions are NOT vacuous.
    expect(liveTicketBefore!.vorname_aus_ticket).toBe("Alice");
    expect(liveTicketBefore!.nachname_aus_ticket).toBe("Wonder");
    expect(anonTicket!.vorname_aus_ticket).toBeUndefined();
    expect(anonTicket!.nachname_aus_ticket).toBeUndefined();
    expect(anonTicket!.fahrt_fahrkartennummer).toBeUndefined();
    expect(anonTicket!.antragstellung_ort).toBeUndefined();
    expect(anonTicket!.antragstellung_datum).toBeUndefined();
    expect(anonTicket!.zusaetzliche_angaben).toBeUndefined();

    // ── Keep-list (must survive anonymisation; CLAUDE.md cascade-spec) ──
    expect(anonTicket!.ticketId).toBe(ticketId);
    expect(anonTicket!.ticket_state).toBeDefined();
    expect(anonTicket!.state_timeline).toBeDefined();
    expect(anonTicket!.fahrt_zugnummer_plan).toBe("ICE517");
    expect(anonTicket!.fahrt_abreisedatum).toBe("2026-06-01");
    expect(anonTicket!.fahrt_abreisebahnhof).toBe("Frankfurt (Main) Hbf");
    expect(anonTicket!.fahrt_zielbahnhof).toBe("Berlin Hbf");
    expect(anonTicket!.fahrt_fahrkartenpreis).toBe("120.00");
    expect(anonTicket!.extraction_method).toBe("MANUAL_ROUTE");
    expect(anonTicket!.extraction_status).toBe("DONE");
    // updated_at rewritten to nowIso — and definitely changed from the seed.
    expect(anonTicket!.updated_at).toBe(NOW.toISOString());
    expect(anonTicket!.updated_at).not.toBe(liveTicketBefore!.updated_at);

    // ── Mandate side ──
    const anonMandate = getRawRow<Record<string, unknown>>(anon, mandateSk(ticketId));
    expect(anonMandate).not.toBeNull();
    expect(anonMandate!.PK).toBe(anon);
    // PII stripped.
    expect(anonMandate!.iban_enc).toBeUndefined();
    expect(anonMandate!.bic_enc).toBeUndefined();
    expect(anonMandate!.kontoinhaber_snapshot).toBeUndefined();
    expect(anonMandate!.user_consent_ip).toBeUndefined();
    expect(anonMandate!.user_consent_user_agent).toBeUndefined();
    // Bookkeeping kept — the HGB-retention contract. pain008_s3_key in
    // particular is the link to the audit XML in S3 and MUST survive.
    expect(anonMandate!.mandate_id).toBeDefined();
    expect(anonMandate!.mandate_state).toBeDefined();
    expect(anonMandate!.sequence_type).toBe("OOFF");
    expect(anonMandate!.fee_amount).toBe("0.75");
    expect(anonMandate!.user_consent_at).toBeDefined();
    expect(anonMandate!.expires_at).toBeDefined();
    expect(anonMandate!.issued_at).toBeDefined();
    expect(anonMandate!.pain008_built_at).toBe(MANDATE_AUDIT_FIXTURE.pain008_built_at);
    expect(anonMandate!.pain008_batch_id).toBe(MANDATE_AUDIT_FIXTURE.pain008_batch_id);
    expect(anonMandate!.pain008_s3_key).toBe(MANDATE_AUDIT_FIXTURE.pain008_s3_key);
    expect(anonMandate!.pain008_submitted_at).toBe(MANDATE_AUDIT_FIXTURE.pain008_submitted_at);
    expect(anonMandate!.debited_at).toBe(MANDATE_AUDIT_FIXTURE.debited_at);
    expect(anonMandate!.vorabankuendigung_sent_at).toBe(MANDATE_AUDIT_FIXTURE.vorabankuendigung_sent_at);

    // ── S3 blobs gone (raw + rendered + each beleg) ──
    const eh = emailHash(email);
    expect(blobExists(`raw/${eh}/${ticketId}.pdf`)).toBe(false);
    expect(blobExists(`rendered/${eh}/${ticketId}.pdf`)).toBe(false);
    for (const belegId of belegIds) {
      expect(blobExists(`belege/${eh}/${ticketId}/${belegId}.jpg`)).toBe(false);
    }

    // TicketOwner gone.
    const owner = await db().ticketOwners.get(ticketId);
    expect(owner).toBeNull();
  });

  it("anonymised ticket clears email-pipeline GSI keys so email-sweeper cannot re-pick it up", async () => {
    // Cross-Lambda safety: a ticket mid-email-retry that gets anonymised
    // must drop out of the email-sweeper queue. If GSI_EMAIL_PENDING_PK
    // survived anonymisation, the next email-sweeper tick would re-fetch
    // this row (with a now-deleted user profile) and crash or re-send to
    // a stale address. Same for email_status / email_attempts /
    // email_last_attempt — those drive the retry decision.
    const { email } = await seedUserScheduledForDeletion({ email: "pending@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email, seedEmailPending: true });

    // Verify the seed actually populated the GSI keys we expect to be cleared.
    const before = getRawRow<Record<string, unknown>>(
      userPk(normaliseEmail(email)),
      ticketSk(ticketId),
    );
    expect(before!.GSI_EMAIL_PENDING_PK).toBe("EMAIL_PENDING");
    expect(before!.email_status).toBe("FAILED_TRANSIENT");

    await runCascadePass({ now: NOW });

    const anon = getRawRow<Record<string, unknown>>(anonPkFor(email), ticketSk(ticketId));
    expect(anon).not.toBeNull();
    expect(anon!.GSI_EMAIL_PENDING_PK).toBeUndefined();
    expect(anon!.GSI_EMAIL_PENDING_SK).toBeUndefined();
    expect(anon!.email_status).toBeUndefined();
    expect(anon!.email_attempts).toBeUndefined();
    expect(anon!.email_last_attempt).toBeUndefined();

    // queryEmailPending now scans live PKs only AND we just cleared the
    // GSI keys — must return nothing for this ticket.
    const pending = await db().tickets.queryEmailPending(10);
    expect(pending.find((t) => t.ticketId === ticketId)).toBeUndefined();
  });

  it("user with no tickets/mandates/templates: profile deleted cleanly", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "bob@example.com" });

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(0);
    expect(result.anonymised_mandates).toBe(0);
    expect(result.deleted_templates).toBe(0);
    expect(result.deleted_blobs).toBe(0);

    const profile = await db().users.getByEmail(email);
    expect(profile).toBeNull();
  });

  it("idempotent over a fully-cascaded user: second run is a no-op", async () => {
    // Seed the FULL bundle (ticket + mandate + beleg + raw + rendered +
    // template + owner) so r2 actually exercises "the cascade has nothing
    // left to do" rather than just "scan returns []".
    const { email } = await seedUserScheduledForDeletion({ email: "carol@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email, belegeCount: 1 });
    await seedMandate({ email, ticketId });
    await seedRouteTemplate(email);

    const r1 = await runCascadePass({ now: NOW });
    expect(r1.cascaded_users).toBe(1);
    expect(r1.anonymised_tickets).toBe(1);

    // Snapshot the anonymised ticket's updated_at — r2 must NOT re-touch it.
    const anon = anonPkFor(email);
    const anonTicketAfterR1 = getRawRow<Record<string, unknown>>(anon, ticketSk(ticketId));
    expect(anonTicketAfterR1).not.toBeNull();

    const r2 = await runCascadePass({ now: NOW });
    expect(r2.cascaded_users).toBe(0);
    expect(r2.anonymised_tickets).toBe(0);
    expect(r2.anonymised_mandates).toBe(0);
    expect(r2.deleted_templates).toBe(0);
    expect(r2.deleted_blobs).toBe(0);

    // The anonymised row is the immutable 10y-archive artefact — r2 must
    // not have shuffled it back to the live PK or re-rewritten updated_at.
    const anonTicketAfterR2 = getRawRow<Record<string, unknown>>(anon, ticketSk(ticketId));
    expect(anonTicketAfterR2).not.toBeNull();
    expect(anonTicketAfterR2!.updated_at).toBe(anonTicketAfterR1!.updated_at);
    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(0);
  });

  it("multiple users: both are processed in one pass", async () => {
    const { email: a } = await seedUserScheduledForDeletion({ email: "alice2@example.com" });
    const { email: b } = await seedUserScheduledForDeletion({ email: "bob2@example.com" });
    await seedTicketWithBlobs({ email: a });
    await seedTicketWithBlobs({ email: b });

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(2);
    expect(result.anonymised_tickets).toBe(2);

    expect(await db().users.getByEmail(a)).toBeNull();
    expect(await db().users.getByEmail(b)).toBeNull();
  });

  it("skip filters: future-ttl + ACTIVE + ACTIVE-with-backdated-ttl untouched; due user still processed", async () => {
    // Three negative cases + one positive: tests that the filter is
    // discriminating (positive case is processed, the three negative
    // cases survive) rather than uniformly broken.
    const { email: future } = await seedUserScheduledForDeletion({
      email: "future@example.com",
      ttlOffsetSec: 3600,
      nowMs: NOW.getTime(),
    });
    const { email: active } = await seedUserActive({ email: "active@example.com" });
    // Defensive case — an ACTIVE user that somehow has a backdated ttl.
    // The state filter (not the ttl filter) must keep this row alive.
    const { email: corrupt } = await seedUserActiveWithBackdatedTtl({
      email: "corrupt@example.com",
      ttlOffsetSec: -3600,
      nowMs: NOW.getTime(),
    });
    const { email: due } = await seedUserScheduledForDeletion({ email: "due@example.com" });

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(1);

    expect(await db().users.getByEmail(future)).not.toBeNull();
    expect(await db().users.getByEmail(active)).not.toBeNull();
    expect(await db().users.getByEmail(corrupt)).not.toBeNull();
    expect(await db().users.getByEmail(due)).toBeNull();
  });

  it("per-user error isolation: one user's cascade throws, next user still processes; bad user's data intact", async () => {
    const { email: bad } = await seedUserScheduledForDeletion({ email: "bad@example.com" });
    const { email: good } = await seedUserScheduledForDeletion({ email: "good@example.com" });
    const { ticketId: badTicketId } = await seedTicketWithBlobs({ email: bad });
    await seedTicketWithBlobs({ email: good });

    // Force the bad user's ticket anonymisation to throw — only when the
    // email matches "bad". The next user's call should proceed normally.
    const orig = db().tickets.anonymiseUserTickets.bind(db().tickets);
    const spy = vi
      .spyOn(db().tickets, "anonymiseUserTickets")
      .mockImplementation(async (email: string, anonPk: string, nowIso: string) => {
        if (email === bad) throw new Error("simulated cascade failure");
        return orig(email, anonPk, nowIso);
      });

    const result = await runCascadePass({ now: NOW });
    spy.mockRestore();

    expect(result.cascaded_users).toBe(1);
    // Good user is anonymised + profile gone.
    expect(await db().users.getByEmail(good)).toBeNull();
    // Bad user's profile still present — error short-circuited before
    // deleteByEmail. Next sweep will pick them up again.
    expect(await db().users.getByEmail(bad)).not.toBeNull();
    // And bad user's ticket is still at the LIVE PK (no half-anonymisation).
    const badLive = getRawRow(userPk(normaliseEmail(bad)), ticketSk(badTicketId));
    expect(badLive).not.toBeNull();
    // No anonymised PK row leaked for the bad user.
    const badAnon = getRawRow(anonPkFor(bad), ticketSk(badTicketId));
    expect(badAnon).toBeNull();
  });

  it("per-blob error: profile retained for retry; second clean run completes the cascade", async () => {
    // Locked behaviour (codex P1#3): if a blob delete throws we MUST
    // keep the profile alive so the next cron tick re-runs the blob
    // loop. Otherwise the leftover S3 object + TicketOwner row would
    // persist forever because deleting the profile removes our only
    // way to scan back to this user.
    const { email } = await seedUserScheduledForDeletion({ email: "blobfail@example.com" });
    await seedTicketWithBlobs({ email });

    const spy = vi
      .spyOn(db().blobs, "deleteRawUpload")
      .mockRejectedValueOnce(new Error("simulated S3 delete failure"));

    const r1 = await runCascadePass({ now: NOW });

    expect(r1.cascaded_users).toBe(1);
    // Profile RETAINED — the throw signalled residue we couldn't clean.
    expect(await db().users.getByEmail(email)).not.toBeNull();

    // mockRejectedValueOnce — second call goes through cleanly.
    spy.mockRestore();

    const r2 = await runCascadePass({ now: NOW });
    expect(r2.cascaded_users).toBe(1);
    // This time the profile drops because the blob loop succeeds.
    expect(await db().users.getByEmail(email)).toBeNull();
  });

  it("template-only user: hard-deletes templates and profile, zero blob counters", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "tplonly@example.com" });
    await seedRouteTemplate(email);
    await seedRouteTemplate(email);
    await seedRouteTemplate(email);

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(1);
    expect(result.deleted_templates).toBe(3);
    expect(result.deleted_blobs).toBe(0);

    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(0);
  });

  it("ticket with no mandate: mandate counter is zero, ticket still anonymised", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "nomand@example.com" });
    await seedTicketWithBlobs({ email, belegeCount: 0, noRawUpload: true, noRenderedPdf: true });

    const result = await runCascadePass({ now: NOW });
    expect(result.anonymised_tickets).toBe(1);
    expect(result.anonymised_mandates).toBe(0);
    expect(result.deleted_blobs).toBe(0);
  });

  it("orphan mandate (no parent ticket): still anonymised AND counted", async () => {
    // Mandate counter must reflect actual work done, not just per-ticket
    // .get() lookups. An orphan mandate (no live ticket) used to be
    // anonymised silently with counter=0 (perf+correctness review). The
    // repo now scans the bucket directly and returns the count.
    const { email } = await seedUserScheduledForDeletion({ email: "orphan@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId });
    // Hard-delete the parent ticket so the mandate is orphaned.
    await db().tickets.delete(email, ticketId);

    const result = await runCascadePass({ now: NOW });
    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(0);
    expect(result.anonymised_mandates).toBe(1);

    const anonMandate = getRawRow<Record<string, unknown>>(anonPkFor(email), mandateSk(ticketId));
    expect(anonMandate).not.toBeNull();
    expect(anonMandate!.iban_enc).toBeUndefined();
  });

  // ── Orphan-PK recovery (codex P1#2) ──
  // DDB's own TTL sweeper can evict the PROFILE row before our daily
  // cron Lambda runs. Without an explicit orphan scan, the user's
  // tickets/mandates/blobs/owner rows would stay under USER#<original-email>
  // un-anonymised forever. cascade.ts runs a second pass over
  // `scanOrphanUserPks()` to catch this.

  it("orphan PK: no profile but live children → cascaded via orphan scan, fully anonymised + cleaned", async () => {
    const { email } = await seedUserActive({ email: "ttl-orphan@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });
    await seedMandate({ email, ticketId });
    await seedRouteTemplate(email);

    // Simulate DDB-TTL eviction: drop the PROFILE row without touching
    // the child rows. The profile-driven scan now misses this user
    // entirely — the orphan scan is the only safety net.
    await db().users.deleteByEmail(email);

    const liveBucket = countRowsUnderPk(userPk(normaliseEmail(email)));
    expect(liveBucket).toBeGreaterThan(0); // child rows still there

    const result = await runCascadePass({ now: NOW });

    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(1);
    expect(result.anonymised_mandates).toBe(1);
    expect(result.deleted_templates).toBe(1);
    expect(result.deleted_blobs).toBe(3); // raw + rendered + 1 beleg

    // Live PK empty; anonymised PK has ticket + mandate.
    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(0);
    const anon = anonPkFor(email);
    expect(getRawRow(anon, ticketSk(ticketId))).not.toBeNull();
    expect(getRawRow(anon, mandateSk(ticketId))).not.toBeNull();
  });

  it("orphan scan skips already-anonymised USER#sha256:<hex> PKs", async () => {
    // Anonymised PKs are the 10y-archive artefact. The orphan scan
    // must NOT re-process them — that would re-write updated_at and
    // bloat the cascade pointlessly. Verify by leaving a sha256-PK
    // with a surviving anonymised ticket and asserting the cascade
    // touches nothing.
    const { email } = await seedUserScheduledForDeletion({ email: "alreadyanon@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email });

    // Run one cascade to produce the anonymised-PK artefact, then run
    // again to make sure the orphan scan doesn't re-pick it up.
    const r1 = await runCascadePass({ now: NOW });
    expect(r1.cascaded_users).toBe(1);

    const anon = anonPkFor(email);
    const beforeR2 = getRawRow<Record<string, unknown>>(anon, ticketSk(ticketId));
    expect(beforeR2).not.toBeNull();

    const r2 = await runCascadePass({ now: NOW });
    expect(r2.cascaded_users).toBe(0);
    expect(r2.anonymised_tickets).toBe(0);

    const afterR2 = getRawRow<Record<string, unknown>>(anon, ticketSk(ticketId));
    expect(afterR2!.updated_at).toBe(beforeR2!.updated_at);
  });

  it("combined: one DELETION_SCHEDULED-expired user + one orphan PK → both processed in one pass", async () => {
    const { email: scheduled } = await seedUserScheduledForDeletion({
      email: "scheduled@example.com",
    });
    await seedTicketWithBlobs({ email: scheduled });

    const { email: orphan } = await seedUserActive({ email: "orphan-combined@example.com" });
    const { ticketId: orphTicket } = await seedTicketWithBlobs({ email: orphan });
    await seedMandate({ email: orphan, ticketId: orphTicket });
    // Wipe the orphan's profile — DDB TTL-eviction simulation.
    await db().users.deleteByEmail(orphan);

    const result = await runCascadePass({ now: NOW });

    // Both users processed in this pass.
    expect(result.cascaded_users).toBe(2);
    expect(result.anonymised_tickets).toBe(2);
    expect(result.anonymised_mandates).toBe(1);

    // Both live PKs empty.
    expect(countRowsUnderPk(userPk(normaliseEmail(scheduled)))).toBe(0);
    expect(countRowsUnderPk(userPk(normaliseEmail(orphan)))).toBe(0);
  });

  it("dry-run: counts would-be work but mutates nothing", async () => {
    const { email } = await seedUserScheduledForDeletion({ email: "dryrun@example.com" });
    const { ticketId } = await seedTicketWithBlobs({ email, belegeCount: 2 });
    await seedMandate({ email, ticketId, seedAuditTrail: true });
    await seedRouteTemplate(email);

    const liveBefore = countRowsUnderPk(userPk(normaliseEmail(email)));
    const anon = anonPkFor(email);

    const result = await runCascadePass({ now: NOW, dryRun: true });

    // Would-be counts: 1 ticket, 1 template, 4 blobs (raw+rendered+2 belege).
    expect(result.cascaded_users).toBe(1);
    expect(result.anonymised_tickets).toBe(1);
    expect(result.deleted_templates).toBe(1);
    expect(result.deleted_blobs).toBe(4);

    // NOTHING mutated: live PK row-count unchanged, profile still present,
    // no anonymised PK created, blobs still there.
    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(liveBefore);
    expect(getRawRow(userPk(normaliseEmail(email)), USER_PROFILE_SK)).not.toBeNull();
    expect(getRawRow(userPk(normaliseEmail(email)), ticketSk(ticketId))).not.toBeNull();
    expect(countRowsUnderPk(anon)).toBe(0);
    expect(await db().blobs.getRawUpload(email, ticketId)).not.toBeNull();
  });

  it("dry-run respects RAILBACK_ANONYMISATION_DRY_RUN=true when no arg passed", async () => {
    vi.stubEnv("RAILBACK_ANONYMISATION_DRY_RUN", "true");
    const { email } = await seedUserScheduledForDeletion({ email: "dryrun-env@example.com" });
    await seedTicketWithBlobs({ email });

    const before = countRowsUnderPk(userPk(normaliseEmail(email)));
    await runCascadePass({ now: NOW });
    // env-driven dry-run: live rows untouched.
    expect(countRowsUnderPk(userPk(normaliseEmail(email)))).toBe(before);
  });
});
