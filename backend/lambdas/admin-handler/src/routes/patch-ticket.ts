// PATCH /admin/tickets/{ticketId}
// - ADMIN-only.
// - Editable: ticket_state (restricted transitions), db_paid_at, admin_note.
// - NEVER editable: erwartete_erstattung, service_fee_betrag, antragsart,
//   antragsgrund, fahrt_*, tatsaechlich_*. The schema's .strict() rejects
//   them at parse time.
//
// Side effect: APPROVED → COMPLETED stamps `archive_ttl = now + 10y` (HGB
// §257 / AO §147). Setting `db_paid_at` is valid on its own (timestamp
// correction) without a state change.
//
// ⚠ DEPLOY-GAP — pain008-generator sync invoke (Phase 2.9):
// ARCHITECTURE.md (L243, L1062) and API_CONTRACT_ADMINFORMS.md (L420)
// say that admin PATCH to APPROVED MUST sync-invoke the pain008-generator
// Lambda. In Phase 2.4 the state transition lands but the sync invoke is
// not yet wired (the Lambda doesn't exist yet). Tracked as
// `PHASE_2_9_PAIN008_GAP` so a CloudWatch alarm can fire on it if the
// gap is still present after Phase 2.9 lands.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { log } from "@railback/lib/http/logging";
import { patchAdminTicketRequestSchema } from "@railback/lib/schemas/admin";
import type { TicketPatch } from "@railback/lib/types/dto";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
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

    if (parsed.data.ticket_state !== undefined) {
      assertTicketTransition(ticket.ticket_state, parsed.data.ticket_state);
      patch.ticket_state = parsed.data.ticket_state;
      // APPROVED → COMPLETED locks the buchungsrelevante 10y archive TTL.
      if (ticket.ticket_state === "APPROVED" && parsed.data.ticket_state === "COMPLETED") {
        patch.archive_ttl = Math.floor(Date.now() / 1000) + 10 * SECONDS_PER_YEAR_AVG;
      }
      // PHASE_2_9_PAIN008_GAP — emit a structured warn line every time
      // we transition into APPROVED. Lets ops see (and alarm on) the
      // gap if Phase 2.9 ships without wiring this site. Drop the
      // log() call together with the gap when the sync invoke lands.
      if (parsed.data.ticket_state === "APPROVED" && ticket.ticket_state !== "APPROVED") {
        log.warn("PHASE_2_9_PAIN008_GAP: ticket APPROVED but pain008-generator not yet invoked", {
          ticketId,
          email: owner.email,
          fromState: ticket.ticket_state,
        });
      }
    }
    if (parsed.data.db_paid_at !== undefined) patch.db_paid_at = parsed.data.db_paid_at;
    if (parsed.data.admin_note !== undefined) patch.admin_note = parsed.data.admin_note;

    const updated = await db().tickets.patch(owner.email, ticketId, patch);

    const user = await db().users.getByEmailAdminView(owner.email);
    const slice: { vorname?: string; nachname?: string } = {};
    if (user) {
      slice.vorname = user.vorname;
      slice.nachname = user.nachname;
    }
    const belege = await db().blobs.listReceipts(owner.email, ticketId);
    const hasBelege = belege.length > 0 || (updated.belege_count ?? 0) > 0;
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
