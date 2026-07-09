// Pass A — GDPR cascade. For every user whose DELETION_SCHEDULED TTL has
// fired we walk their child rows under USER#<email> and:
//   1. List ticketIds for the user (so blob/owner cleanup keys off the live PK).
//   2. Per-ticket: delete RawUpload / RenderedPdf / Receipts (DDB row +
//      matching S3 object) and the TicketOwner mapping row. Any failure
//      sets `hadFailures` — we still attempt every other delete but we
//      will NOT drop the profile this tick (next tick retries the residue).
//   3. Hard-delete RouteTemplates (no S3 side).
//   4. Anonymise mandates: PK -> USER#sha256:<full hex>, null IBAN/BIC
//      + consent fingerprint, keep audit / bookkeeping columns. Failure
//      here bubbles to the outer per-user catch — the profile stays alive,
//      next tick retries via the live PK.
//   5. Anonymise tickets: PK -> same anon PK, strip PII fields. The
//      `anonymised_tickets` counter uses the REPO'S return value — the
//      live `ticketIds` enumeration was only a working list for the blob
//      loop.
//   6. Hard-delete the User profile row ONLY if no per-blob/owner failures
//      were observed. Otherwise log retry-pending and leave the profile;
//      next tick re-runs the blob loop (delete-by-key is idempotent under
//      missing rows) and drops the profile when it finally comes clean.
//
// Orphan recovery: if DDB's own TTL sweeper drops the PROFILE before our
// cron Lambda runs, child rows are stranded under USER#<original-email>
// with no profile to scan. After the profile-driven loop we run a SECOND
// loop over `scanOrphanUserPks()` — same cascadeOneUser logic.
//
// pain008 audit XML in S3 is NOT touched here — DB_SCHEMA.md is explicit
// that HGB retention overrides DSGVO erasure for buchungsrelevante
// artefacts, and the mandate row's pain008_s3_key column is preserved by
// step 4 above precisely so the audit trail stays linkable. Likewise
// `sepa-reports/` S3 prefix is NOT touched — same HGB-retention rationale.
//
// Per-user errors are caught at the outer loop so one bad row does not
// poison the whole batch.

import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { emailFingerprint, sha256Hex } from "@railback/lib/util/hash";
import { normaliseEmail } from "@railback/lib/storage/ddb/keys";

export interface RunCascadePassArgs {
  now: Date;
  /**
   * Dry-run: enumerate + count what WOULD be anonymised/deleted, but perform
   * no destructive writes. Anonymisation is irreversible (PII stripped, PK
   * rewritten), so the first prod run should be gated. Defaults to true unless
   * RAILBACK_ANONYMISATION_DRY_RUN is explicitly "false" — a fresh deploy is
   * safe-by-default; flip the env var to arm the sweeper.
   */
  dryRun?: boolean;
}

export interface RunCascadePassResult {
  cascaded_users: number;
  anonymised_tickets: number;
  anonymised_mandates: number;
  deleted_templates: number;
  deleted_blobs: number;
}

interface UserCounters {
  anonymised_tickets: number;
  anonymised_mandates: number;
  deleted_templates: number;
  deleted_blobs: number;
}

function applyCounters(totals: RunCascadePassResult, c: UserCounters): void {
  totals.cascaded_users++;
  totals.anonymised_tickets += c.anonymised_tickets;
  totals.anonymised_mandates += c.anonymised_mandates;
  totals.deleted_templates += c.deleted_templates;
  totals.deleted_blobs += c.deleted_blobs;
}

export async function runCascadePass(args: RunCascadePassArgs): Promise<RunCascadePassResult> {
  const nowEpochSec = Math.floor(args.now.getTime() / 1000);
  const nowIso = args.now.toISOString();
  // Default-safe: dry-run unless the env var explicitly says "false".
  const dryRun = args.dryRun
    ?? (process.env["RAILBACK_ANONYMISATION_DRY_RUN"] !== "false");

  const totals: RunCascadePassResult = {
    cascaded_users: 0,
    anonymised_tickets: 0,
    anonymised_mandates: 0,
    deleted_templates: 0,
    deleted_blobs: 0,
  };

  // Pass A.1 — profile-driven: users with a still-live PROFILE row whose
  // DELETION_SCHEDULED TTL fired.
  const users = await db().users.scanDeletionScheduledExpired(nowEpochSec);
  for (const user of users) {
    try {
      const counters = await cascadeOneUser(user.email, nowIso, dryRun);
      applyCounters(totals, counters);
      log.info("anonymisation-sweeper.cascade.user_done", {
        email_hash: emailFingerprint(user.email),
        dry_run: dryRun,
        ...counters,
      });
    } catch (err) {
      log.error("anonymisation-sweeper.cascade.user_failed", {
        email_hash: emailFingerprint(user.email),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Pass A.2 — orphan recovery: child rows under USER#<email> whose
  // PROFILE was already evicted by DDB's TTL sweeper before we got
  // here. Same cascadeOneUser; it tolerates the missing profile (the
  // final users.deleteByEmail is a no-op on absent rows).
  const orphans = await db().users.scanOrphanUserPks();
  for (const email of orphans) {
    try {
      const counters = await cascadeOneUser(email, nowIso, dryRun);
      applyCounters(totals, counters);
      log.info("anonymisation-sweeper.cascade.orphan_done", {
        email_hash: emailFingerprint(email),
        dry_run: dryRun,
        ...counters,
      });
    } catch (err) {
      log.error("anonymisation-sweeper.cascade.orphan_failed", {
        email_hash: emailFingerprint(email),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // SUMMARY — one line the operator can eyeball before arming the sweeper.
  // In dry-run the counts are "would-be" figures; no rows were mutated.
  log.info("anonymisation-sweeper.cascade.summary", { dry_run: dryRun, ...totals });

  return totals;
}

async function cascadeOneUser(email: string, nowIso: string, dryRun: boolean): Promise<UserCounters> {
  const norm = normaliseEmail(email);
  // DB_SCHEMA.md §"Cascade on user delete" item 3 line 1026: anonymised PK
  // uses the FULL sha256 hex (not the 16-char emailHash prefix).
  const anonPk = `USER#sha256:${sha256Hex(norm)}`;

  // 1. Enumerate ticketIds under the LIVE PK before anonymise rewrites
  //    them away. Uses `enumerateAllTicketIdsForUser` (not `listForUser`)
  //    so stranded blob/mandate rows from previously hard-deleted tickets
  //    still get their RAW/RENDERED/BELEG/OWNER cleanup in this pass.
  const ticketIds = await db().tickets.enumerateAllTicketIdsForUser(email);

  // DRY-RUN: read-only accounting. Count what a real run WOULD touch —
  // blob rows that exist, template count, mandate + ticket count — without
  // deleting or rewriting anything. Returns before any destructive call.
  if (dryRun) {
    let wouldDeleteBlobs = 0;
    for (const ticketId of ticketIds) {
      if (await db().blobs.getRawUpload(email, ticketId)) wouldDeleteBlobs++;
      if (await db().blobs.getRenderedPdf(email, ticketId)) wouldDeleteBlobs++;
      wouldDeleteBlobs += (await db().blobs.listReceipts(email, ticketId)).length;
    }
    const templates = await db().routeTemplates.list(email);
    return {
      anonymised_tickets: ticketIds.length,
      anonymised_mandates: 0, // no non-destructive mandate enumerator; reported at real-run time
      deleted_templates: templates.length,
      deleted_blobs: wouldDeleteBlobs,
    };
  }

  // 2. Per-ticket blob + TicketOwner cleanup FIRST, under the live PK.
  //    Track failures: any per-call throw flips `hadFailures` and we
  //    keep the profile alive at the end so the next cron tick re-runs
  //    this loop. The deletes are idempotent under missing rows, so the
  //    retry tick walks through cleanly when S3 is back.
  let hadFailures = false;
  let deletedBlobs = 0;
  for (const ticketId of ticketIds) {
    try {
      const raw = await db().blobs.deleteRawUpload(email, ticketId);
      if (raw.s3_key !== null) deletedBlobs++;
    } catch (err) {
      hadFailures = true;
      log.error("anonymisation-sweeper.cascade.delete_raw_failed", {
        ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      const rendered = await db().blobs.deleteRenderedPdf(email, ticketId);
      if (rendered.s3_key !== null) deletedBlobs++;
    } catch (err) {
      hadFailures = true;
      log.error("anonymisation-sweeper.cascade.delete_rendered_failed", {
        ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      const receipts = await db().blobs.deleteAllReceipts(email, ticketId);
      deletedBlobs += receipts.s3_keys.length;
    } catch (err) {
      hadFailures = true;
      log.error("anonymisation-sweeper.cascade.delete_receipts_failed", {
        ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await db().ticketOwners.delete(ticketId);
    } catch (err) {
      hadFailures = true;
      log.error("anonymisation-sweeper.cascade.delete_owner_failed", {
        ticketId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Route templates — hard-delete, no S3.
  let deletedTemplates = 0;
  try {
    deletedTemplates = await db().routeTemplates.deleteAllForUser(email);
  } catch (err) {
    hadFailures = true;
    log.error("anonymisation-sweeper.cascade.delete_templates_failed", {
      email_hash: emailFingerprint(email),
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Mandates — anonymise. Failure bubbles to outer per-user catch;
  //    the profile stays alive and next tick retries.
  const mandateCount = await db().mandates.anonymiseUserMandates(email, anonPk);
  const mandatesCount = mandateCount.count;

  // 5. Tickets — anonymise in place at the new PK. Counter uses the
  //    repo's return value (spec contract); ticketIds from step 1 is
  //    just the working list for the blob loop.
  const { ticketIds: anonTicketIds } = await db().tickets.anonymiseUserTickets(
    email,
    anonPk,
    nowIso,
  );

  // 6. Profile. Drop ONLY when this user has zero residual blob/owner
  //    failures — otherwise the next tick must be able to find the
  //    profile-driven scan-entry to retry, or the orphan-scan picks it
  //    up if DDB's TTL evicts the profile first.
  if (!hadFailures) {
    await db().users.deleteByEmail(email);
  } else {
    log.warn("anonymisation-sweeper.cascade.user_retry_pending", {
      email_hash: emailFingerprint(email),
      anonymised_tickets: anonTicketIds.length,
      anonymised_mandates: mandatesCount,
    });
  }

  return {
    anonymised_tickets: anonTicketIds.length,
    anonymised_mandates: mandatesCount,
    deleted_templates: deletedTemplates,
    deleted_blobs: deletedBlobs,
  };
}
