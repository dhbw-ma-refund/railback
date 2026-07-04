// sepa-reports Lambda orchestrator. S3-event-triggered: an admin has uploaded
// a pain.002 / camt.054 / camt.053 XML into `sepa-reports/<YYYY-MM-DD>/<reportId>.xml`
// via `POST /admin/sepa/reports/upload` (presigned POST). The S3 ObjectCreated
// notification hands us `bucket` + `key`.
//
// Pipeline per record:
//   1. Decompose the key: `sepa-reports/<date>/<reportId>.xml`. `reportId` is
//      the S3 basename AND the idempotency key. Reject anything else — the
//      admin upload presign policy pins this shape.
//   2. Idempotency: db().sepaReports.getByReportId(date, reportId) — if a row
//      exists, log skip and return.
//   3. Load raw bytes from S3, decode as UTF-8. Missing = throw (S3 will
//      retry — the notification arrived faster than the object was queryable).
//   4. Sniff the XML kind (regex) → dispatch to parse-reports.
//   5. Resolve each parsed mandateId → live SepaMandate row via
//      MandateRepo.getByMandateId (linear scan in v1). Unknown mandateIds
//      surface as `mandate=null` in the decision resolver — the pure
//      decision layer maps them to SKIP + skipReason=unknown_mandate.
//   6. Compute decisions via apply-transitions.
//   7. Apply decisions IN ORDER, per-decision try/catch:
//        DEBITED → tickets.patch(service_fee_state=DEBITED) then mandates.markDebited
//        REVERSED → tickets.patch(service_fee_state=REVERSED) then mandates.markReversed
//        DISPUTED → tickets.patch(service_fee_state=REVERSED) then mandates.markDisputed
//        SKIP → nothing (already logged upstream)
//      Order (ticket-first, then mandate) mirrors anonymisation-sweeper's
//      "expire-mandates.ts" ordering discipline — see CLAUDE.md and
//      DB_SCHEMA.md §"service_fee_state mirror".
//   8. Send R-tx notification emails for decisions with shouldNotify=true.
//      Never-throws — a bad email doesn't roll back the state change.
//   9. Persist the SepaReport audit row with mandates_correlated =
//      list of mandateIds we successfully applied a transition to (or
//      camt.053 skipped-informational, or SKIP-because-unknown, etc. — we
//      record every parsed mandateId, not just successful ones, so the
//      row is a real audit trail).
//
// Error handling:
//   - Idempotent replay (row already exists): log skip, return; do NOT
//     re-process.
//   - Unparseable XML: log error + rethrow. S3 retry semantics will
//     replay a few times; DLQ eventually. We deliberately don't quarantine
//     the object — admin-uploaded XML is admin-quarantined-by-eye already.
//   - Storage errors on state-transition: caught per-decision, classified
//     as transient vs permanent by isTransientError below.
//     * Permanent (AppError ERR_VALIDATION / ERR_NOT_FOUND / ERR_FORBIDDEN):
//       log, skip, keep going. Audit row IS written — retrying would fail
//       the same way, so we commit the idempotency guard and move on.
//     * Transient (raw Error, AWS-SDK exception, or AppError
//       ERR_INTERNAL / ERR_CONFLICT): log, skip within the loop, but after
//       the loop we THROW without writing the audit row. That surfaces to
//       the S3-event source (retry + DLQ) and, crucially, keeps the
//       idempotency slot open so the retry can resume the whole file.
//       Without this, a single ThrottlingException would silently commit
//       the audit row and permanently strand the affected mandates.

import { AppError } from "@railback/lib/errors";
import { log } from "@railback/lib/http/logging";
import { db } from "@railback/lib/storage";
import { SEPA_REPORT_TTL_SECONDS } from "@railback/lib/storage/types";
import {
  parseCamt053,
  parseCamt054,
  parsePain002,
  type Camt05xResult,
  type Pain002Result,
} from "@railback/lib/sepa/parse-reports";
import type {
  SepaMandate,
  NewSepaReport,
} from "@railback/lib/types/dto";
import type { SepaReportType } from "@railback/lib/types/items";
import type { ServiceFeeState } from "@railback/lib/types/enums";

import { detectReportKind, type ReportKind } from "./detect-kind.js";
import {
  decideBatch,
  type MandateDecision,
} from "./apply-transitions.js";
import { sendRtxNotifyEmail } from "./notify.js";

export interface ProcessReportArgs {
  s3Bucket: string;
  s3Key: string;
  /** Optional — defaults to now. */
  receivedAt?: string;
  /** Optional bank/sender label carried into the SepaReport audit row. */
  sender?: string;
}

// -- Error classification --------------------------------------------------

/**
 * Classify a caught error from a mandate/ticket storage call as either
 * transient (retry-worthy) or permanent (poison-pill; commit idempotency
 * row and move on). See file-header docstring for the semantic split.
 *
 * Rules:
 *   - AppError with ERR_VALIDATION / ERR_NOT_FOUND / ERR_FORBIDDEN → permanent
 *   - AppError with any other code (ERR_INTERNAL, ERR_CONFLICT, ...) → transient
 *   - Anything else (raw Error, AWS SDK exception object, non-Error thrown
 *     value) → transient. AWS SDK errors typically have a `name` field
 *     like "ThrottlingException" / "ProvisionedThroughputExceededException"
 *     / "ServiceUnavailable" — all retry-worthy.
 */
function isTransientError(err: unknown): boolean {
  if (err instanceof AppError) {
    return !(
      err.code === "ERR_VALIDATION" ||
      err.code === "ERR_NOT_FOUND" ||
      err.code === "ERR_FORBIDDEN"
    );
  }
  return true;
}

export interface ProcessReportResult {
  reportId: string;
  date: string;
  kind: ReportKind;
  decisionsApplied: number;
  decisionsSkipped: number;
  notificationsSent: number;
  /** True when we no-op'd on an existing report row. */
  idempotentSkip: boolean;
}

// -- Key parsing -----------------------------------------------------------

const KEY_RE =
  /^sepa-reports\/(\d{4}-\d{2}-\d{2})\/([^/]+)\.xml$/;

function parseKey(key: string): { date: string; reportId: string } {
  const m = KEY_RE.exec(key);
  if (!m) {
    throw new AppError(
      "ERR_VALIDATION",
      `sepa-reports: S3 key does not match sepa-reports/<YYYY-MM-DD>/<reportId>.xml: ${key}`,
      undefined,
      { field: "s3_key" },
    );
  }
  const date = m[1]!;
  const reportId = m[2]!;
  return { date, reportId };
}

// -- Top-level processor --------------------------------------------------

export async function processReport(
  args: ProcessReportArgs,
): Promise<ProcessReportResult> {
  const { s3Bucket, s3Key } = args;
  const receivedAt = args.receivedAt ?? new Date().toISOString();
  const sender = args.sender ?? "";

  const { date, reportId } = parseKey(s3Key);

  // Idempotency check — a second S3 event for the same object (retry / SNS
  // replay) must be a no-op. This is the primary defence; a real DDB impl
  // adds an attribute_not_exists guard on put() to close the TOCTOU race.
  const existing = await db().sepaReports.getByReportId(date, reportId);
  if (existing) {
    log.info("sepa-reports.skip.already_ingested", {
      date,
      reportId,
      s3_key: s3Key,
      report_type: existing.report_type,
    });
    return {
      reportId,
      date,
      kind: existing.report_type as ReportKind,
      decisionsApplied: 0,
      decisionsSkipped: 0,
      notificationsSent: 0,
      idempotentSkip: true,
    };
  }

  // Load bytes.
  const blob = await db().blobs.getBytes(s3Key);
  if (!blob) {
    // Deliberate throw: S3 says the object exists (we got the event) but the
    // GET can't find it. Retryable — the object may not have replicated yet.
    throw new AppError(
      "ERR_NOT_FOUND",
      `sepa-reports: S3 object missing at ${s3Key}`,
      undefined,
      { field: "s3_key" },
    );
  }
  const xml = Buffer.from(blob.bytes).toString("utf-8");

  // Sniff + parse.
  const kind = detectReportKind(xml);
  const parsed: Pain002Result | Camt05xResult =
    kind === "PAIN002"
      ? parsePain002(xml)
      : kind === "CAMT054"
        ? parseCamt054(xml)
        : parseCamt053(xml);

  // MsgId inside the XML must match the S3-key-derived reportId. Mismatch is
  // an admin-side upload error (wrong filename) — we WARN but still use the
  // key-derived reportId as the canonical DDB SK (it's the S3-key basename
  // and therefore the object of truth for idempotency).
  if (parsed.reportId && parsed.reportId !== reportId) {
    log.warn("sepa-reports.report_id.mismatch", {
      keyReportId: reportId,
      msgId: parsed.reportId,
      s3_key: s3Key,
    });
  }

  log.info("sepa-reports.parse.ok", {
    date,
    reportId,
    kind,
    mandate_count: parsed.mandates.length,
    s3_key: s3Key,
  });

  // Resolve mandates ONCE (dedupe repeat mandateIds within one report).
  const uniqueMandateIds = Array.from(
    new Set(parsed.mandates.map((m) => m.mandateId)),
  );
  const resolver = new Map<string, SepaMandate | null>();
  for (const mid of uniqueMandateIds) {
    const m = await db().mandates.getByMandateId(mid);
    resolver.set(mid, m);
    if (m === null) {
      log.warn("sepa-reports.mandate.unknown", {
        reportId,
        mandateId: mid,
      });
    }
  }

  // Pure decision layer.
  const decisions = decideBatch(kind, parsed, resolver);

  // Apply. Per-decision try/catch so one failure doesn't kill the batch.
  let applied = 0;
  let skipped = 0;
  let notified = 0;
  let transientFailures = 0;
  const correlated: string[] = [];

  for (const decision of decisions) {
    // Every parsed mandateId is recorded on the audit row, even SKIPs —
    // otherwise "we saw this report and did nothing about mandate X" isn't
    // reconstructable from DDB.
    correlated.push(decision.mandateId);

    if (decision.action === "SKIP") {
      skipped++;
      log.info("sepa-reports.decision.skip", {
        reportId,
        mandateId: decision.mandateId,
        reason: decision.skipReason,
        reasonCode: decision.reasonCode,
      });
      continue;
    }

    const mandate = resolver.get(decision.mandateId);
    if (!mandate) {
      // Resolver returned null but decision wasn't SKIP — the pure layer
      // shouldn't emit that, but defence-in-depth. Log and skip.
      log.error("sepa-reports.decision.no_mandate", {
        reportId,
        mandateId: decision.mandateId,
        action: decision.action,
      });
      skipped++;
      continue;
    }

    try {
      await applyDecision(decision, mandate);
      applied++;
      log.info("sepa-reports.transition.applied", {
        reportId,
        mandateId: decision.mandateId,
        ticketId: mandate.ticketId,
        from: mandate.mandate_state,
        to: decision.action,
        reasonCode: decision.reasonCode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const transient = isTransientError(err);
      const code = err instanceof AppError ? err.code : undefined;
      log.error("sepa-reports.transition.failed", {
        reportId,
        mandateId: decision.mandateId,
        ticketId: mandate.ticketId,
        action: decision.action,
        message: msg,
        transient,
        code,
      });
      skipped++;
      if (transient) transientFailures++;
      continue;
    }

    if (decision.shouldNotify && decision.classified && decision.reasonCode) {
      try {
        const sent = await sendNotifyForDecision(decision, mandate);
        if (sent) notified++;
      } catch (err) {
        // sendRtxNotifyEmail never throws; only the config-error env-var
        // path does. Log and continue — one bad email doesn't roll back the
        // state change.
        const msg = err instanceof Error ? err.message : String(err);
        log.error("sepa-reports.notify.failed", {
          reportId,
          mandateId: decision.mandateId,
          ticketId: mandate.ticketId,
          message: msg,
        });
      }
    }
  }

  // If any decision hit a transient storage failure, do NOT commit the
  // idempotency row. Throwing here surfaces to the S3-event source, which
  // retries the whole file; on retry we'll re-enter processReport, find
  // no existing report row, and re-run the pipeline (applying the two
  // successful transitions is idempotent — decideBatch maps DEBITED→DEBITED
  // etc. to SKIP, so re-application is a no-op on the already-transitioned
  // mandates and a fresh attempt on the previously-failed one).
  if (transientFailures > 0) {
    log.error("sepa-reports.transient_failure.abort", {
      reportId,
      transient_failure_count: transientFailures,
      applied,
      skipped,
    });
    throw new AppError(
      "ERR_INTERNAL",
      "sepa-reports: transient storage failure(s); not committing audit row so retry can resume",
      undefined,
      { transient_failure_count: transientFailures, reportId, date },
    );
  }

  // Persist the audit row.
  const reportType: SepaReportType =
    kind === "PAIN002" ? "PAIN002" : kind === "CAMT054" ? "CAMT054" : "CAMT053";
  // 10y retention (buchungsrelevant per HGB §257 / AO §147). Stamped from
  // received_at so re-processing preserves the original ingestion clock.
  const ttl = Math.floor(new Date(receivedAt).getTime() / 1000) + SEPA_REPORT_TTL_SECONDS;
  const newRow: NewSepaReport = {
    date,
    reportId,
    report_type: reportType,
    s3_bucket: s3Bucket,
    s3_key: s3Key,
    sender,
    mandates_correlated: correlated,
    received_at: receivedAt,
    ttl,
  };
  await db().sepaReports.put(newRow);

  log.info("sepa-reports.done", {
    date,
    reportId,
    kind,
    applied,
    skipped,
    notified,
    mandates_correlated: correlated.length,
  });

  return {
    reportId,
    date,
    kind,
    decisionsApplied: applied,
    decisionsSkipped: skipped,
    notificationsSent: notified,
    idempotentSkip: false,
  };
}

// -- Decision → storage ---------------------------------------------------

async function applyDecision(
  decision: MandateDecision,
  mandate: SepaMandate,
): Promise<void> {
  const now = new Date().toISOString();
  const email = mandate.email;
  const ticketId = mandate.ticketId;

  // Ticket-first, then mandate. See CLAUDE.md / anonymisation-sweeper for
  // the ordering rationale. If tickets.patch throws, we do NOT touch the
  // mandate row — the mirror stays consistent (ticket state trails the
  // mandate by at most one report-ingest tick).
  const targetFeeState: ServiceFeeState =
    decision.action === "DEBITED" ? "DEBITED" : "REVERSED";

  await db().tickets.patch(email, ticketId, {
    service_fee_state: targetFeeState,
  });

  if (decision.action === "DEBITED") {
    await db().mandates.markDebited(email, ticketId, now);
  } else if (decision.action === "REVERSED") {
    await db().mandates.markReversed(email, ticketId, {
      reversedAt: now,
      reason: decision.reasonCode ?? "UNKNOWN",
    });
  } else {
    // DISPUTED. reversed_reason is not written by markDisputed; the reason
    // code appears on the R-tx notify email and in the SepaReport audit row.
    await db().mandates.markDisputed(email, ticketId, now);
  }
}

async function sendNotifyForDecision(
  decision: MandateDecision,
  mandate: SepaMandate,
): Promise<boolean> {
  // We need vorname/nachname for the greeting — pull from the user profile.
  // Anonymisation would nul them, but by definition an anonymised user has
  // an anonymised mandate PK and would have failed the resolver earlier.
  const user = await db().users.getByEmail(mandate.email);
  if (!user) {
    log.warn("sepa-reports.notify.no_user", {
      email: mandate.email,
      mandateId: decision.mandateId,
    });
    return false;
  }
  if (
    decision.action === "SKIP" ||
    decision.action === "DEBITED" ||
    decision.classified === undefined ||
    decision.reasonCode === undefined
  ) {
    // DEBITED is never a notify target (shouldNotify would be false), but
    // the narrowing keeps the TS union tight for sendRtxNotifyEmail's
    // "REVERSED" | "DISPUTED" input.
    return false;
  }
  const res = await sendRtxNotifyEmail({
    to: mandate.email,
    vorname: user.vorname,
    nachname: user.nachname,
    ticketId: mandate.ticketId,
    action: decision.action,
    reasonCode: decision.reasonCode,
    classified: decision.classified,
  });
  return res.ok;
}

// -- S3-event entry --------------------------------------------------------

/**
 * Minimal S3 event shape — we only need bucket.name and object.key from
 * each record. Full @types/aws-lambda would work too, but the lambdas in
 * this repo intentionally keep the AWS type surface local (see auth-handler
 * event.ts for the same idiom).
 */
export interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string };
  };
}

export interface S3Event {
  Records: S3EventRecord[];
}

export interface HandlerResult {
  ok: true;
  processed: number;
  failed: number;
}

/**
 * Lambda entrypoint. S3 ObjectCreated triggers this with one-or-many records.
 * Each record is a separate report and is processed independently: a failure
 * on one record no longer aborts the remaining records in the same event.
 * Instead we track successes vs failures, run through the full batch, and
 * — if any record failed — throw an aggregate AppError AT THE END so S3 event
 * source retries + DLQ still see the failure signal. Records that succeeded
 * on this attempt will be idempotent no-ops on the retry.
 */
export async function handler(event: S3Event): Promise<HandlerResult> {
  const records = event?.Records ?? [];
  let processed = 0;
  let failed = 0;
  const failedKeys: string[] = [];
  let firstErrorCode: string | undefined;
  let firstErrorMessage: string | undefined;
  for (const r of records) {
    const s3Bucket = r.s3.bucket.name;
    const s3Key = decodeS3Key(r.s3.object.key);
    try {
      await processReport({ s3Bucket, s3Key });
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof AppError ? err.code : "UNKNOWN";
      log.error("sepa-reports.record.failed", {
        s3_bucket: s3Bucket,
        s3_key: s3Key,
        code,
        message: msg,
      });
      failed++;
      failedKeys.push(s3Key);
      if (firstErrorCode === undefined) {
        firstErrorCode = code;
        firstErrorMessage = msg;
      }
      // Do NOT rethrow here — keep processing the rest of the batch. We
      // aggregate + throw once at the end so S3 retry/DLQ still fires.
    }
  }
  if (failed > 0) {
    throw new AppError(
      "ERR_INTERNAL",
      `sepa-reports: ${failed} of ${records.length} record(s) failed`,
      undefined,
      {
        failed_count: failed,
        first_error_code: firstErrorCode,
        first_error_message: firstErrorMessage,
        failed_keys: failedKeys,
      },
    );
  }
  return { ok: true, processed, failed };
}

/**
 * S3 event keys are URL-encoded with spaces as `+` and other special chars
 * as `%XX`. Reverse both. Our keys under `sepa-reports/` are ULID-based so
 * this is defensive, but the pattern is standard.
 */
function decodeS3Key(raw: string): string {
  return decodeURIComponent(raw.replace(/\+/g, " "));
}
