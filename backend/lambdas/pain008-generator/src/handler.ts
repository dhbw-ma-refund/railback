// Storage bootstrap (side-effect): registers the "ddb" backend so db()
// resolves under RAILBACK_STORAGE=ddb at cold start. Must precede any db()
// call. Memory-mode is registered by the vitest setup files instead.
import "@railback/lib/storage/bootstrap";

// pain008-generator entrypoint — sync-invoked from admin-handler PATCH
// /admin/tickets/{ticketId} on the * → APPROVED transition.
//
// Pipeline:
//   1. Load mandate; bail with ERR_NOT_FOUND if missing.
//   2. Idempotency: if pain008_built_at already set → log + return.
//   3. State guard: mandate_state must be ISSUED.
//   4. Load ticket (referential integrity + we need ticketId for the
//      <Ustrd> line, even though that's just args.ticketId).
//   5. Decrypt IBAN/BIC from the mandate snapshot (NOT user profile —
//      snapshot is locked at issue time).
//   6. generateBatchId() + builtAt = now.
//   7. buildPain008Xml(...) — runs the full SEPA validator stack
//      (mandate-state / sequence-type / fee-amount / expiry /
//      IBAN-mod97 / BIC / Gläubiger-ID / env-vars). AppErrors propagate.
//   8. Persist bytes to S3 at pain008/<YYYY-MM>/<batchId>.xml.
//   9. Stamp the mandate row with batchId / s3Key / builtAt.
//      Mandate STAYS in ISSUED state — the ISSUED → SUBMITTED transition
//      lives in admin-handler's POST /admin/sepa/batches/{id}/mark-submitted.
//
// Write order is deliberate: S3 first, then mandate stamp. A failure
// mid-way leaves orphaned bytes in S3 (lifecycle = 10y, harmless) but
// the mandate row stays unstamped so a retry re-builds + re-writes a
// fresh batch-id-named object. The reverse order would risk a stamped
// mandate pointing at nonexistent bytes — much worse for audit.

import { AppError } from "@railback/lib/errors";
import { log } from "@railback/lib/http/logging";
import { db } from "@railback/lib/storage";
import { DecryptionFailedError, decryptBic, decryptIban } from "@railback/lib/crypto/iban";
import { buildPain008Xml } from "@railback/lib/sepa/pain008";
import { generateBatchId } from "@railback/lib/sepa/mandate-id";

import { persistPain008Xml } from "./persist.js";

export interface GeneratePain008Args {
  email: string;
  ticketId: string;
}

/**
 * Render the pain.008.001.09 SEPA-DD XML for a single mandate, persist it
 * to S3, and stamp the mandate row. Sync-invoked from admin-handler's
 * APPROVED transition.
 *
 * Throws on every failure path — there is no silent retry queue here.
 * Caller (admin-handler patch-ticket) turns the throw into a 5xx; the
 * ticket transition has already landed in DDB so admin can see APPROVED
 * but no pain008_built_at and follow up via future tooling.
 */
export async function generatePain008(args: GeneratePain008Args): Promise<void> {
  const { email, ticketId } = args;

  // 1. Load mandate.
  const mandate = await db().mandates.get(email, ticketId);
  if (!mandate) {
    throw new AppError(
      "ERR_NOT_FOUND",
      `mandate for ticket ${ticketId} not found`,
    );
  }

  // 2. Idempotency. buildPain008Xml would throw ERR_VALIDATION on a
  //    re-build, but the pre-check keeps the no-op out of the noisy
  //    validation-error bucket and surfaces it as a structured info
  //    log line instead.
  if (mandate.pain008_built_at) {
    log.info("pain008.skip.already_built", {
      ticketId,
      mandateId: mandate.mandate_id,
      pain008_batch_id: mandate.pain008_batch_id,
      pain008_built_at: mandate.pain008_built_at,
    });
    return;
  }

  // 3. State guard. buildPain008Xml also enforces this, but having the
  //    check here makes the error path explicit and keeps the stack
  //    trace pointing at the call site rather than at the validator.
  if (mandate.mandate_state !== "ISSUED") {
    throw new AppError(
      "ERR_VALIDATION",
      `pain008: mandate_state must be ISSUED, got ${mandate.mandate_state}`,
      undefined,
      { field: "mandate.mandate_state" },
    );
  }

  // 4. Load ticket (referential integrity gate; the XML itself only
  //    needs ticketId, which we already have on args).
  const ticket = await db().tickets.get(email, ticketId);
  if (!ticket) {
    // Mandate exists but the ticket vanished — anonymisation race.
    // Surface as 5xx; an operator must reconcile manually.
    throw new AppError(
      "ERR_INTERNAL",
      `ticket ${ticketId} not found for mandate ${mandate.mandate_id}`,
    );
  }

  // 5. Decrypt IBAN/BIC from the mandate snapshot. The snapshot is the
  //    authoritative source post-issue — user-profile edits after the
  //    /refund submit are intentionally NOT reflected (regulatory
  //    requirement, see DECISIONS.md 2026-06-17).
  let debtorIbanPlain: string;
  let debtorBicPlain: string;
  try {
    debtorIbanPlain = decryptIban(mandate.iban_enc);
    debtorBicPlain = decryptBic(mandate.bic_enc);
  } catch (err) {
    if (err instanceof DecryptionFailedError) {
      throw new AppError(
        "ERR_INTERNAL",
        "IBAN/BIC ciphertext could not be decrypted",
      );
    }
    throw err;
  }

  // 6. Generate batch id + builtAt timestamp.
  const batchId = generateBatchId();
  const builtAt = new Date().toISOString();

  // 7. Build XML. All SEPA validators run inside this call and propagate
  //    AppErrors verbatim — no need to wrap.
  const xml = buildPain008Xml({
    batchId,
    builtAt,
    mandate,
    ticket: { ticketId },
    debtorIbanPlain,
    debtorBicPlain,
  });

  // 8. Encode UTF-8 bytes. Buffer.from gives us a Buffer (Node-only
  //    subclass of Uint8Array); BlobRepo.putBytes takes Uint8Array.
  //    Re-wrap explicitly so the static type matches and any in-memory
  //    BlobRepo doing instanceof checks behaves identically across runtimes.
  const buf = Buffer.from(xml, "utf-8");
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  // 9. Persist bytes to S3 — BEFORE stamping the mandate. See header
  //    comment for the rationale.
  const { s3_key, size_bytes } = await persistPain008Xml({ batchId, builtAt, bytes });

  // 10. Stamp the mandate row under a conditional write. Mandate stays in
  //     ISSUED. If the conditional fails (double-build race — another
  //     concurrent invoke already stamped) OR the mandate row vanished
  //     (anonymisation race), we clean up the S3 object we just wrote so
  //     we don't leak cleartext debtor IBAN/BIC into the 10y audit prefix.
  //     The contract is documented on `MandateRepo.stampPain008Built` in
  //     `lib/src/storage/types.ts` and locked in SEPA_PAIN008.md §7.
  try {
    await db().mandates.stampPain008Built(email, ticketId, {
      batchId,
      s3Key: s3_key,
      builtAt,
    });
  } catch (err) {
    if (err instanceof AppError && (err.code === "ERR_CONFLICT" || err.code === "ERR_NOT_FOUND")) {
      // Best-effort orphan cleanup. deleteBytes is idempotent so a missing
      // object is a no-op. We swallow the cleanup error itself — the
      // primary error below is the operator-visible one.
      try {
        await db().blobs.deleteBytes(s3_key);
        log.info("pain008.cleanup.orphan_deleted", {
          ticketId,
          mandateId: mandate.mandate_id,
          batchId,
          s3Key: s3_key,
          reason: err.code,
        });
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        log.error("pain008.cleanup.orphan_delete_failed", {
          ticketId,
          mandateId: mandate.mandate_id,
          batchId,
          s3Key: s3_key,
          message: msg,
        });
      }
    }
    throw err;
  }

  log.info("pain008.built", {
    ticketId,
    mandateId: mandate.mandate_id,
    batchId,
    s3Key: s3_key,
    size: size_bytes,
  });
}
