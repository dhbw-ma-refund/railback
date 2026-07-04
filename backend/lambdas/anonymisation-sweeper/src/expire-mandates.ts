// Pass B — Mandate expiry. ISSUED mandates past their 36-month `expires_at`
// flip to EXPIRED. The linked ticket's `service_fee_state` mirrors to
// `WAIVED` because an expired mandate can no longer collect our fee — the
// happy path is dead, the defensive zero-fee guard wins.
//
// Ordering (locked): patch the TICKET first, then markExpired the mandate.
// If the ticket-patch fails with anything other than ERR_NOT_FOUND we skip
// this mandate for the tick — it stays ISSUED, listExpiringISSUED returns
// it again next time, and the retry has a clean shot at both rows. The
// reverse order would orphan the mirror: markExpired succeeds, listExpiringISSUED
// no longer surfaces the mandate, ticket never flips to WAIVED. ERR_NOT_FOUND
// on the ticket-patch is the legitimate orphan path (Pass A anonymised this
// user in the same invocation) — log warn and proceed with markExpired.
//
// Idempotent: listExpiringISSUED filters by mandate_state="ISSUED" so a
// re-run never re-touches a mandate that already flipped to EXPIRED.

import { AppError } from "@railback/lib";
import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { emailFingerprint } from "@railback/lib/util/hash";

export interface RunExpireMandatesPassArgs {
  now: Date;
}

export interface RunExpireMandatesPassResult {
  expired_mandates: number;
}

export async function runExpireMandatesPass(
  args: RunExpireMandatesPassArgs,
): Promise<RunExpireMandatesPassResult> {
  const nowIso = args.now.toISOString();
  const expiring = await db().mandates.listExpiringISSUED(nowIso);

  let expired = 0;
  for (const mandate of expiring) {
    // 1. Mirror the ticket FIRST. NOT_FOUND is the orphan path (Pass A
    //    already anonymised this user) — log + proceed. Any OTHER error
    //    means the mirror is in an unknown state; skip markExpired this
    //    tick so next tick can retry both writes atomically.
    try {
      await db().tickets.patch(mandate.email, mandate.ticketId, {
        service_fee_state: "WAIVED",
      });
    } catch (err) {
      if (err instanceof AppError && err.code === "ERR_NOT_FOUND") {
        log.warn("anonymisation-sweeper.expire.ticket_missing", {
          ticketId: mandate.ticketId,
          email_hash: emailFingerprint(mandate.email),
          message: err.message,
        });
        // fall through to markExpired — orphan ticket is fine.
      } else {
        log.error("anonymisation-sweeper.expire.ticket_patch_failed", {
          ticketId: mandate.ticketId,
          mandate_id: mandate.mandate_id,
          email_hash: emailFingerprint(mandate.email),
          message: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
    }

    // 2. Flip the mandate. Counter only increments when markExpired
    //    succeeds — a mandate that fails to flip stays ISSUED and
    //    listExpiringISSUED will surface it again next tick.
    try {
      await db().mandates.markExpired(mandate.email, mandate.ticketId);
      expired++;
      log.info("anonymisation-sweeper.expire.mandate", {
        ticketId: mandate.ticketId,
        mandate_id: mandate.mandate_id,
        email_hash: emailFingerprint(mandate.email),
      });
    } catch (err) {
      log.error("anonymisation-sweeper.expire.mandate_failed", {
        ticketId: mandate.ticketId,
        mandate_id: mandate.mandate_id,
        email_hash: emailFingerprint(mandate.email),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { expired_mandates: expired };
}
