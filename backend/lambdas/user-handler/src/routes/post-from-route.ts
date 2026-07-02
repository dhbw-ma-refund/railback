// POST /users/me/tickets/from-route
// - Route-template flow: creates a Ticket directly in `READY` without
//   any file upload / extractor. Path locked in CLAUDE.md
//   ("Route-Template-Refunds für tickets ohne barcode/PDF").
// - `extraction_method = "MANUAL_ROUTE"`, `extraction_confidence = 0`.
//   No barcode_uid — there's nothing to dedup against. From here the
//   normal refund flow (delays-lookup → POST /refund) runs unchanged.
// - ticketId: caller-supplied (idempotency, lets the frontend retry
//   the request without creating duplicates) or generated server-side
//   via ulid(). If a row already exists for that (email, ticketId) we
//   return ERR_CONFLICT with details.existing_ticket_id = ticketId.
// - is_zeitkarte: passed straight through onto the Ticket row (locked
//   2026-06-20 — zeitkarten share this flow with single-trip).
// - Station-name resolution: both ends must hit the top-200 list. We
//   persist the canonical names (Hbf-aliased) so subsequent
//   /delays-lookup-by-name in the same flow finds the same EVA.
// - templateId is accepted but currently not persisted on the ticket
//   (RouteTemplate is its own DDB row, the link is informational).
//   Forwarded to the repo in case it grows persistence later.
// - Companion TicketOwner row is written via ticketOwners.put — the
//   admin-handler / email-webhook / extractor flows look up the owning
//   email by ticketId via that mapping (locked 2026-06-20). For the
//   in-memory backend this is two distinct writes; the DDB backend
//   should later promote it to a TransactWriteItems.

import {
  fromRouteRequestSchema,
  type FromRouteResponse,
} from "@railback/lib/schemas/ticket";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { resolveStation } from "@railback/lib/refund/stations";
import { ulid } from "@railback/lib/util/ulid";
import type { NewRouteTicket } from "@railback/lib";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

export async function handlePostFromRoute(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = fromRouteRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "from-route body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const fromStation = resolveStation(parsed.data.fromStation);
    if (!fromStation) {
      throw new AppError(
        "ERR_VALIDATION",
        "fromStation could not be resolved",
        undefined,
        { field: "fromStation", value: parsed.data.fromStation },
      );
    }
    const toStation = resolveStation(parsed.data.toStation);
    if (!toStation) {
      throw new AppError(
        "ERR_VALIDATION",
        "toStation could not be resolved",
        undefined,
        { field: "toStation", value: parsed.data.toStation },
      );
    }

    const ticketId = parsed.data.ticketId ?? ulid();
    const dbi = db();

    // Idempotency / duplicate-create guard. If the caller supplied a
    // ticketId that's already on file, refuse — don't silently overwrite
    // a ticket potentially mid-flow. (Server-generated ulids collide
    // with negligible probability so this branch is mostly for caller-
    // supplied ids.)
    const existing = await dbi.tickets.get(email, ticketId);
    if (existing) {
      throw new AppError(
        "ERR_CONFLICT",
        "a ticket with this id already exists",
        undefined,
        { existing_ticket_id: ticketId },
      );
    }

    // Cross-user ownership-hijack defence: if a TicketOwner row already
    // exists for this ticketId, refuse. The in-memory ticketOwners.put
    // is an unconditional putRow — without this check, UserB could submit
    // an id known to belong to UserA and overwrite the mapping, breaking
    // every admin / webhook / extractor reverse-lookup that trusts the
    // mapping row (CLAUDE.md 2026-06-20). The DDB backend will later
    // enforce this via TransactWriteItems + attribute_not_exists; until
    // then the application-side check closes the hole.
    const ownerLock = await dbi.ticketOwners.get(ticketId);
    if (ownerLock && ownerLock.email !== email) {
      throw new AppError(
        "ERR_CONFLICT",
        "a ticket with this id already exists",
        undefined,
        { existing_ticket_id: ticketId },
      );
    }

    const newRoute: NewRouteTicket = {
      email,
      ticketId,
      trainNr: parsed.data.trainNr,
      date: parsed.data.date,
      fromStation: fromStation.name,
      fromEva: fromStation.eva,
      toStation: toStation.name,
      toEva: toStation.eva,
      abfahrtszeit_plan: parsed.data.abfahrtszeit_plan,
      ankunftszeit_plan: parsed.data.ankunftszeit_plan,
      fahrkartennummer: parsed.data.fahrkartennummer,
      fahrkartenpreis: parsed.data.fahrkartenpreis,
      is_zeitkarte: parsed.data.is_zeitkarte,
    };
    if (parsed.data.templateId !== undefined) {
      newRoute.templateId = parsed.data.templateId;
    }

    // Owner-mapping row goes FIRST. If it fails we don't end up with an
    // orphan ticket whose reverse-lookups can't find an email. The
    // mapping is the cheaper write of the two.
    await dbi.ticketOwners.put(ticketId, email);
    await dbi.tickets.createFromRoute(newRoute);

    const response: FromRouteResponse = {
      ticketId,
      ticket_state: "READY",
      extraction_method: "MANUAL_ROUTE",
      extraction_confidence: 0,
    };
    return okJson(201, response);
  } catch (err) {
    return errorResponse(err);
  }
}
