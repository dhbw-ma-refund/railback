// GET /admin/tickets/{ticketId}
// - ADMIN-only.
// - Resolves email via TicketOwner mapping row (locked 2026-06-20).
// - Joins user (vorname/nachname only, NEVER iban/bic) and the SepaMandate
//   for the sepa_mandate sub-object.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { ticketDetailView } from "../projections.js";

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

export async function handleGetTicket(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const ticketId = extractTicketId(event);

    const owner = await db().ticketOwners.get(ticketId);
    if (!owner) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }
    const ticket = await db().tickets.get(owner.email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `ticket ${ticketId} not found`);
    }

    const user = await db().users.getByEmailAdminView(owner.email);
    const slice: { vorname?: string; nachname?: string } = {};
    if (user) {
      slice.vorname = user.vorname;
      slice.nachname = user.nachname;
    }

    const belege = await db().blobs.listReceipts(owner.email, ticketId);
    const hasBelege = belege.length > 0 || (ticket.belege_count ?? 0) > 0;

    const mandate = await db().mandates.get(owner.email, ticketId);

    const extras: Parameters<typeof ticketDetailView>[1] = {
      user: slice,
      hasBelege,
    };
    if (mandate) extras.mandate = mandate;

    return okJson(200, ticketDetailView(ticket, extras));
  } catch (err) {
    return errorResponse(err);
  }
}
