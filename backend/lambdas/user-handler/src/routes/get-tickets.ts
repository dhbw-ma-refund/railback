// GET /users/me/tickets
// - Bearer auth (USER only).
// - Returns ALL tickets owned by the caller, projected to TicketSummary
//   (subset of fields the listing UI needs — full ticket lives at
//   GET /users/me/tickets/{ticketId}).
// - Sorted by updated_at DESC: the wizard typically wants the most
//   recently touched ticket first (latest extraction result, latest
//   refund-submit). The repo's natural order is by ticketId, but ULIDs
//   are roughly time-ordered too, so the sort is mostly a tie-breaker —
//   we still do it explicitly because nothing in the DDB contract
//   guarantees ULID order matches updated_at after a patch (e.g. a
//   ticket that sat in VALIDATING for a while then got resubmitted).
// - No filtering / pagination (admin-tooling scale, user-side scale
//   is tiny — a single user has at most a handful of tickets). If that
//   ever changes we add ?state= / ?cursor= here.
// - No ownership check beyond requireUserCaller: listForUser is keyed
//   on the caller's email, so it physically cannot return rows owned
//   by anyone else.

import { db } from "@railback/lib/storage";
import type { Ticket } from "@railback/lib/types/dto";
import type { TicketSummary } from "@railback/lib/schemas/ticket";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

function toSummary(t: Ticket): TicketSummary {
  const out: TicketSummary = {
    ticketId: t.ticketId,
    ticket_state: t.ticket_state,
    updated_at: t.updated_at,
  };
  if (t.fahrt_abreisedatum !== undefined) out.abreisedatum = t.fahrt_abreisedatum;
  if (t.fahrt_abreisebahnhof !== undefined) out.abreisebahnhof = t.fahrt_abreisebahnhof;
  if (t.fahrt_zielbahnhof !== undefined) out.zielbahnhof = t.fahrt_zielbahnhof;
  if (t.fahrt_fahrkartenpreis !== undefined) out.fahrkartenpreis = t.fahrt_fahrkartenpreis;
  if (t.antragsart !== undefined) out.antragsart = t.antragsart;
  if (t.erwartete_erstattung !== undefined) out.erwartete_erstattung = t.erwartete_erstattung;
  if (t.email_status !== undefined) out.email_status = t.email_status;
  if (t.submitted_at !== undefined) out.submitted_at = t.submitted_at;
  return out;
}

export async function handleGetTickets(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const tickets = await db().tickets.listForUser(email);
    // updated_at is an ISO-8601 string; lexicographic compare = chronological.
    const sorted = [...tickets].sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
    );
    return okJson(200, { items: sorted.map(toSummary) });
  } catch (err) {
    return errorResponse(err);
  }
}
