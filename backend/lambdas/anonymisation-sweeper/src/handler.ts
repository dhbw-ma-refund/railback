// Storage bootstrap (side-effect): registers the "ddb" backend so db()
// resolves under RAILBACK_STORAGE=ddb at cold start. Must precede any db()
// call. Memory-mode is registered by the vitest setup files instead.
import "@railback/lib/storage/bootstrap";

// anonymisation-sweeper entrypoint — EventBridge cron, rate(1 day).
//
// Two independent passes per invocation:
//   Pass A — GDPR cascade for users whose DELETION_SCHEDULED TTL has fired.
//            Anonymises tickets + mandates (PK rewrite to USER#sha256:<hex>,
//            PII fields stripped), hard-deletes route-templates / raw uploads
//            / rendered PDFs / belege / TicketOwner mapping rows / the user
//            profile itself. pain008 S3 audit XML is NOT touched — HGB
//            retention overrides DSGVO erasure for buchungsrelevante
//            artefacts.
//   Pass B — Mandate expiry: ISSUED mandates past `expires_at` flip to
//            EXPIRED, ticket service_fee_state mirrors to WAIVED.
//
// Each pass is wrapped in its own try/catch so a Pass B blow-up does NOT
// mask Pass A's completed work, and vice-versa. Per-user / per-mandate
// errors inside a pass are swallowed and logged so one bad row doesn't
// poison the whole batch.

import { log } from "@railback/lib/http/logging";

import { runCascadePass } from "./cascade.js";
import { runExpireMandatesPass } from "./expire-mandates.js";

export interface SweepResult {
  cascaded_users: number;
  anonymised_tickets: number;
  anonymised_mandates: number;
  deleted_templates: number;
  deleted_blobs: number;
  expired_mandates: number;
}

// Test seam — handler reads "now" via this indirection so cascade.spec /
// expire-mandates.spec / handler.spec can pin the clock. Default is the
// production wall-clock.
let _now: () => Date = () => new Date();

/** Test seam — inject a deterministic clock, or pass null to reset. */
export function _setNow(fn: (() => Date) | null): void {
  _now = fn ?? (() => new Date());
}

/** EventBridge cron handler. Returns a summary suitable for CloudWatch metrics. */
export async function handler(_event?: unknown): Promise<SweepResult> {
  // One clock per invocation, shared by both passes. Deliberate: Pass B uses
  // it for the `expires_at` comparison, Pass A uses it both for the TTL
  // window and for the anonymised `updated_at` timestamp.
  const now = _now();
  const result: SweepResult = {
    cascaded_users: 0,
    anonymised_tickets: 0,
    anonymised_mandates: 0,
    deleted_templates: 0,
    deleted_blobs: 0,
    expired_mandates: 0,
  };

  // Pass A — GDPR cascade.
  try {
    const cascade = await runCascadePass({ now });
    result.cascaded_users = cascade.cascaded_users;
    result.anonymised_tickets = cascade.anonymised_tickets;
    result.anonymised_mandates = cascade.anonymised_mandates;
    result.deleted_templates = cascade.deleted_templates;
    result.deleted_blobs = cascade.deleted_blobs;
  } catch (err) {
    log.error("anonymisation-sweeper.cascade.pass_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // Pass B — mandate expiry. Runs even if Pass A blew up; the two passes are
  // independent state machines.
  try {
    const expire = await runExpireMandatesPass({ now });
    result.expired_mandates = expire.expired_mandates;
  } catch (err) {
    log.error("anonymisation-sweeper.expire.pass_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  log.info("anonymisation-sweeper.done", { ...result });
  return result;
}
