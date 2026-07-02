// GET /users/me/tickets/{ticketId}
// - Bearer auth (USER only).
// - Returns the full ticket projection (TicketResponse).
// - 404 ERR_NOT_FOUND if no ticket with that id exists for the caller.
//   Because the repo is keyed on (email, ticketId), the same call also
//   covers "someone else's ticket id" — they get a 404, not a 403, so
//   we never confirm/deny existence to a non-owner.
// - Projection drops fields that are NOT in ticketResponseSchema:
//     ttl, archive_ttl  — DDB-internal TTL bookkeeping; users don't
//                         need to see when their data expires.
//     service_fee_state — internal SEPA pipeline detail; users see
//                         the amount, not the mandate state machine.
//     email_provider_id — SES internal id; useful for ops, not users.
//   This matches the schema 1:1 so the frontend can rely on the
//   zod-inferred type.
// - No iban/bic anywhere — tickets never store those (the SEPA mandate
//   row does, separately). Defence-in-depth: no field-by-field copy of
//   the full DTO; we enumerate the response fields explicitly.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { Ticket } from "@railback/lib/types/dto";
import type { TicketResponse } from "@railback/lib/schemas/ticket";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

function readTicketId(event: ApiGwEvent): string | undefined {
  const fromParams = event.pathParameters?.ticketId;
  if (fromParams) return fromParams;
  // Fallback when running without the dispatcher's path-param extraction.
  const path = event.requestContext?.http?.path ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)$/);
  return m?.[1];
}

function toResponse(t: Ticket): TicketResponse {
  const out: TicketResponse = {
    email: t.email,
    ticketId: t.ticketId,
    ticket_state: t.ticket_state,
    state_timeline: t.state_timeline,
    extraction_status: t.extraction_status,
    extraction_method: t.extraction_method,
    extraction_confidence: t.extraction_confidence,
    updated_at: t.updated_at,
  };
  // Optional fields — copy only when defined to keep responses tight.
  if (t.barcode_uid !== undefined) out.barcode_uid = t.barcode_uid;
  if (t.vorname_aus_ticket !== undefined) out.vorname_aus_ticket = t.vorname_aus_ticket;
  if (t.nachname_aus_ticket !== undefined) out.nachname_aus_ticket = t.nachname_aus_ticket;
  if (t.fahrt_abreisedatum !== undefined) out.fahrt_abreisedatum = t.fahrt_abreisedatum;
  if (t.fahrt_abreisebahnhof !== undefined) out.fahrt_abreisebahnhof = t.fahrt_abreisebahnhof;
  if (t.fahrt_zielbahnhof !== undefined) out.fahrt_zielbahnhof = t.fahrt_zielbahnhof;
  if (t.fahrt_abfahrtszeit_plan !== undefined) out.fahrt_abfahrtszeit_plan = t.fahrt_abfahrtszeit_plan;
  if (t.fahrt_ankunftszeit_plan !== undefined) out.fahrt_ankunftszeit_plan = t.fahrt_ankunftszeit_plan;
  if (t.fahrt_zugnummer_plan !== undefined) out.fahrt_zugnummer_plan = t.fahrt_zugnummer_plan;
  if (t.fahrt_zugkategorie_plan !== undefined) out.fahrt_zugkategorie_plan = t.fahrt_zugkategorie_plan;
  if (t.fahrt_fahrkartennummer !== undefined) out.fahrt_fahrkartennummer = t.fahrt_fahrkartennummer;
  if (t.fahrt_fahrkartenpreis !== undefined) out.fahrt_fahrkartenpreis = t.fahrt_fahrkartenpreis;
  if (t.tatsaechlich_ankunftsdatum !== undefined) out.tatsaechlich_ankunftsdatum = t.tatsaechlich_ankunftsdatum;
  if (t.tatsaechlich_abfahrtszeit !== undefined) out.tatsaechlich_abfahrtszeit = t.tatsaechlich_abfahrtszeit;
  if (t.tatsaechlich_ankunftszeit !== undefined) out.tatsaechlich_ankunftszeit = t.tatsaechlich_ankunftszeit;
  if (t.tatsaechlich_zugnummer !== undefined) out.tatsaechlich_zugnummer = t.tatsaechlich_zugnummer;
  if (t.tatsaechlich_verpasster_anschluss_bahnhof !== undefined) {
    out.tatsaechlich_verpasster_anschluss_bahnhof = t.tatsaechlich_verpasster_anschluss_bahnhof;
  }
  if (t.antragsgrund !== undefined) out.antragsgrund = t.antragsgrund;
  if (t.antragsart !== undefined) out.antragsart = t.antragsart;
  if (t.is_zeitkarte !== undefined) out.is_zeitkarte = t.is_zeitkarte;
  if (t.antragstellung_ort !== undefined) out.antragstellung_ort = t.antragstellung_ort;
  if (t.antragstellung_datum !== undefined) out.antragstellung_datum = t.antragstellung_datum;
  if (t.zusaetzliche_angaben !== undefined) out.zusaetzliche_angaben = t.zusaetzliche_angaben;
  if (t.datenschutz_einwilligung !== undefined) out.datenschutz_einwilligung = t.datenschutz_einwilligung;
  if (t.wahrheitserklaerung !== undefined) out.wahrheitserklaerung = t.wahrheitserklaerung;
  if (t.delayMinutes !== undefined) out.delayMinutes = t.delayMinutes;
  if (t.erwartete_erstattung !== undefined) out.erwartete_erstattung = t.erwartete_erstattung;
  if (t.service_fee_betrag !== undefined) out.service_fee_betrag = t.service_fee_betrag;
  if (t.db_paid_at !== undefined) out.db_paid_at = t.db_paid_at;
  if (t.admin_note !== undefined) out.admin_note = t.admin_note;
  if (t.email_status !== undefined) out.email_status = t.email_status;
  if (t.email_attempts !== undefined) out.email_attempts = t.email_attempts;
  if (t.email_last_attempt !== undefined) out.email_last_attempt = t.email_last_attempt;
  if (t.email_failed_reason !== undefined) out.email_failed_reason = t.email_failed_reason;
  if (t.uploaded_at !== undefined) out.uploaded_at = t.uploaded_at;
  if (t.submitted_at !== undefined) out.submitted_at = t.submitted_at;
  if (t.belege_count !== undefined) out.belege_count = t.belege_count;
  return out;
}

export async function handleGetTicket(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const ticketId = readTicketId(event);
    if (!ticketId) {
      throw new AppError("ERR_VALIDATION", "ticketId path parameter is required");
    }
    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `Ticket ${ticketId} not found`);
    }
    return okJson(200, toResponse(ticket));
  } catch (err) {
    return errorResponse(err);
  }
}
