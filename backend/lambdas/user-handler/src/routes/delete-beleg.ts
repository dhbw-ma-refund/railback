// DELETE /users/me/tickets/{ticketId}/belege/{belegId}
// - Bearer auth (USER only). Caller must own the ticket.
// - 409 if the ticket is past READY — once /refund-submit ran, the PDF
//   is on its way to the user and removing supporting belege after the
//   fact would leave the EU-form referencing things that no longer
//   exist.
// - 404 if the beleg doesn't exist (we list-and-find — there's no
//   get-by-id on the repo; admin-tooling scale).
// - Decrements ticket.belege_count, floored at 0 (defence-in-depth
//   against a count that drifted out of sync).
// - Returns 204 noContent on success.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, noContent } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

const TICKET_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function extractPathIds(event: ApiGwEvent): { ticketId: string; belegId: string } {
  const fromParams = event.pathParameters ?? {};
  const t = fromParams["ticketId"];
  const b = fromParams["belegId"];
  if (t && TICKET_ID_RE.test(t) && b && ULID_RE.test(b)) {
    return { ticketId: t, belegId: b };
  }
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(
    /^\/users\/me\/tickets\/([^/]+)\/belege\/([^/]+)$/,
  );
  const tt = m?.[1];
  const bb = m?.[2];
  if (tt && TICKET_ID_RE.test(tt) && bb && ULID_RE.test(bb)) {
    return { ticketId: tt, belegId: bb };
  }
  throw new AppError(
    "ERR_VALIDATION",
    "ticketId or belegId path parameter is invalid",
  );
}

export async function handleDeleteBeleg(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const { ticketId, belegId } = extractPathIds(event);

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `Ticket ${ticketId} not found`);
    }
    if (ticket.ticket_state !== "VALIDATING" && ticket.ticket_state !== "READY") {
      throw new AppError(
        "ERR_CONFLICT",
        "belege cannot be removed after refund submission",
        undefined,
        { current_state: ticket.ticket_state },
      );
    }

    const belege = await db().blobs.listReceipts(email, ticketId);
    const target = belege.find((b) => b.belegId === belegId);
    if (!target) {
      throw new AppError("ERR_NOT_FOUND", `Beleg ${belegId} not found`);
    }

    await db().blobs.deleteReceipt(email, ticketId, belegId);

    const newCount = Math.max(0, (ticket.belege_count ?? belege.length) - 1);
    await db().tickets.patch(email, ticketId, { belege_count: newCount });

    return noContent();
  } catch (err) {
    return errorResponse(err);
  }
}
