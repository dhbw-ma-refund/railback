// PATCH /admin/tickets/{ticketId}
// - ADMIN-only.
// - Editable: ticket_state (restricted transitions), db_paid_at, admin_note.
// - NEVER editable: erwartete_erstattung, service_fee_betrag, antragsart,
//   antragsgrund, fahrt_*, tatsaechlich_*. The schema's .strict() rejects
//   them at parse time.
//
// TTL stamping on state transitions (DB_SCHEMA §DSGVO rows 986-987):
//   - APPROVED → COMPLETED: `archive_ttl = now + 10y` (HGB §257 / AO §147
//     retention, application-side cleanup that anonymises rather than
//     deletes).
//   - * → REJECTED / * → INVALID: `ttl = now + 90d` (DDB TTL, hard-drops
//     the row after the window since nothing personenbezogen needs to
//     survive when no money flowed).
//   - EMAIL_FAILED is stamped by refund-pdf / email-webhook, not here.
//
// Setting `db_paid_at` is valid on its own (timestamp correction) without
// a state change.
//
// pain008-generator sync invoke (Phase 2.9): the * → APPROVED transition
// triggers a sync-invoke of @railback/pain008-generator. Order matters:
// the ticket patch lands FIRST, then we look up the mandate and invoke
// pain008-generator AFTER. Rationale: the admin's intent (approve) is
// independent of pain008-build success. If pain008 fails we surface the
// 5xx so the admin sees the gap, but the ticket stays APPROVED — the
// mandate row simply has no pain008_built_at and an operator retries via
// `POST /admin/tickets/{ticketId}/pain008-rebuild` (see post-pain008-rebuild.ts).
//
// Guards before invoke (all must hold):
//   1. Actual state delta — old ticket_state !== APPROVED, new === APPROVED.
//      Admin PATCHing APPROVED→APPROVED must not re-build.
//   2. SepaMandate row exists — zero-fee waiver path has no mandate, and
//      no mandate means nothing to debit.
//   3. mandate.pain008_built_at not already set — pain008-generator's own
//      validator would throw ERR_VALIDATION, but the pre-check keeps the
//      log out of the noisy bucket.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { patchAdminTicketRequestSchema } from "@railback/lib/schemas/admin";
import type { TicketPatch } from "@railback/lib/types/dto";
import { emailHash as hashEmailForLog } from "@railback/lib/util/hash";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { invokePain008Generator } from "../pain008-invoke.js";
import { ticketDetailView } from "../projections.js";
import { assertTicketTransition } from "../state-machines.js";

const SECONDS_PER_DAY = 24 * 60 * 60;
// Average Gregorian year incl. leap-day correction. Using a flat 365-day
// year would drift ~2.5 days short over 10y, possibly cutting the
// buchungsrelevant retention window early. 365.2425 is the Gregorian
// mean year length (matches the calendar exactly over 400y).
const SECONDS_PER_YEAR_AVG = Math.round(365.2425 * SECONDS_PER_DAY);

function extractTicketId(event: ApiGwEvent): string {
  const fromParams = event.pathParameters?.["ticketId"];
  if (typeof fromParams === "string" && fromParams.length > 0) return decodeURIComponent(fromParams);
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/tickets\/([^/]+)$/);
  if (!m || !m[1]) {
    throw new AppError("ERR_VALIDATION", "ticketId path parameter is missing");
  }
  return decodeURIComponent(m[1]);
}

/**
 * Sync invoke of the pain008-generator Lambda — see ../pain008-invoke.ts
 * for the shared shim. The same module is reused by
 * `POST /admin/tickets/{ticketId}/pain008-rebuild` (operator retry path).
 */

export async function handlePatchTicket(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const ticketId = extractTicketId(event);

    const body = readJsonBody(event);
    const parsed = patchAdminTicketRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "patch body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const owner = await db().ticketOwners.get(ticketId);
    if (!owner) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }
    const ticket = await db().tickets.get(owner.email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }

    const patch: TicketPatch = {};

    // Capture the pain008-invoke-trigger boolean before tickets.patch lands.
    // We need both the pre-state (to detect the * → APPROVED delta) and
    // the parsed new state. The actual invoke happens AFTER tickets.patch
    // so a pain008 failure doesn't roll back the admin's approval intent.
    const willTransitionToApproved =
      parsed.data.ticket_state === "APPROVED" && ticket.ticket_state !== "APPROVED";

    if (parsed.data.ticket_state !== undefined) {
      assertTicketTransition(ticket.ticket_state, parsed.data.ticket_state);
      patch.ticket_state = parsed.data.ticket_state;
      // APPROVED → COMPLETED locks the buchungsrelevante 10y archive TTL.
      if (ticket.ticket_state === "APPROVED" && parsed.data.ticket_state === "COMPLETED") {
        patch.archive_ttl = Math.floor(Date.now() / 1000) + 10 * SECONDS_PER_YEAR_AVG;
      }
      // → REJECTED / → INVALID stamps the 90-day DDB TTL (DB_SCHEMA §DSGVO
      // rows 986-987: terminal-without-money-flow retention). Without this
      // stamp rejected/invalid rows would live forever, contradicting the
      // "no personenbezogen data beyond retention" invariant. Locked as a
      // fix on 2026-07-01 per audit finding `missing-ttl-on-terminal-
      // transitions`. EMAIL_FAILED is stamped by refund-pdf / email-webhook,
      // not here — admin doesn't drive that state.
      if (
        parsed.data.ticket_state === "REJECTED" ||
        parsed.data.ticket_state === "INVALID"
      ) {
        patch.ttl = Math.floor(Date.now() / 1000) + 90 * SECONDS_PER_DAY;
      }
    }
    if (parsed.data.db_paid_at !== undefined) patch.db_paid_at = parsed.data.db_paid_at;
    if (parsed.data.admin_note !== undefined) patch.admin_note = parsed.data.admin_note;

    const updated = await db().tickets.patch(owner.email, ticketId, patch);

    // pain008-generator sync invoke (Phase 2.9). Order: patch lands first
    // (admin's intent is committed), THEN we attempt the build. A pain008
    // failure surfaces as 5xx so the operator notices, but the ticket
    // state stays APPROVED — the mandate row simply has no pain008_built_at
    // and the operator retries via
    // `POST /admin/tickets/{ticketId}/pain008-rebuild`. See file-header
    // comment for the full rationale.
    if (willTransitionToApproved) {
      const mandate = await db().mandates.get(owner.email, ticketId);
      if (mandate && !mandate.pain008_built_at) {
        try {
          await invokePain008Generator({ email: owner.email, ticketId });
        } catch (err) {
          // PII-leakage guard: pain008 validation errors carry `details.field`
          // values like "debtorIbanPlain" / "debtorBicPlain" /
          // "mandate.vorabankuendigung_sent_at". Admins never observe IBAN/BIC
          // by contract, and the admin doesn't own banking-data validity
          // either — log the real reason server-side and surface an opaque
          // ERR_INTERNAL so the response body stays clean. Anonymise the
          // hashable email identifier in the log line too.
          const message = err instanceof Error ? err.message : String(err);
          const code = err instanceof AppError ? err.code : "ERR_UNKNOWN";
          const field = err instanceof AppError ? err.details?.["field"] : undefined;
          log.error("pain008-generator.failed", {
            ticketId,
            emailHash: hashEmailForLog(owner.email),
            code,
            field,
            message,
          });
          if (err instanceof AppError && err.code === "ERR_VALIDATION") {
            throw new AppError(
              "ERR_INTERNAL",
              "pain008-build failed; an operator will follow up",
            );
          }
          throw err;
        }
      } else if (!mandate) {
        // Zero-fee waiver path: nothing to debit, nothing to build.
        log.info("pain008.skip.no_mandate", {
          ticketId,
          emailHash: hashEmailForLog(owner.email),
        });
      }
    }

    const user = await db().users.getByEmailAdminView(owner.email);
    const slice: { vorname?: string; nachname?: string } = {};
    if (user) {
      slice.vorname = user.vorname;
      slice.nachname = user.nachname;
    }
    const belege = await db().blobs.listReceipts(owner.email, ticketId);
    const hasBelege = belege.length > 0 || (updated.belege_count ?? 0) > 0;
    // Re-load mandate post-invoke. The admin-side `sepaMandateView`
    // projection deliberately strips `pain008_*` (admin doesn't get to
    // observe banking-data internals), so the response shape is unchanged
    // whether we read the row pre- or post-invoke. The re-fetch is kept
    // so a future contract change that exposes `pain008_built_at` to
    // admins doesn't silently return stale data — drop it together with
    // any such projection update.
    const mandate = await db().mandates.get(owner.email, ticketId);

    const extras: Parameters<typeof ticketDetailView>[1] = {
      user: slice,
      hasBelege,
    };
    if (mandate) extras.mandate = mandate;

    return okJson(200, ticketDetailView(updated, extras));
  } catch (err) {
    return errorResponse(err);
  }
}
