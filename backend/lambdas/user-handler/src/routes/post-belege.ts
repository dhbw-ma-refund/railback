// POST /users/me/tickets/{ticketId}/belege
// - Bearer auth (USER only).
// - ticketId is a path param. Caller must own the ticket — the repo
//   is keyed on (email, ticketId) so a non-owner gets 404.
// - Request body: { filename, mimeType, typ } — validated via
//   belegPresignRequestSchema.
// - Locked 2026-06-18: presigned POST (not PUT) so the S3 policy can
//   enforce 5 MB content-length-range server-side.
// - 5-beleg cap: refuse a 6th presign with ERR_CONFLICT. The S3 mock
//   enforces this again at putReceipt time, but rejecting here saves
//   the user a wasted upload.
// - Ticket state must be pre-submit (VALIDATING or READY). Belege are
//   only relevant for KOSTEN_ALTERNATIVTRANSPORT and that decision is
//   made at /refund-submit; once we're past READY the PDF is already
//   rendered/sent so a new beleg can't make it onto the form.
// - belegId is allocated server-side (via presignReceiptPost in the
//   blob repo) and embedded into the s3_key — the route parses it back
//   out so the frontend can echo the same id on /confirm.

import { belegPresignRequestSchema } from "@railback/lib/schemas/ticket";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

const TICKET_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function extractTicketId(event: ApiGwEvent): string {
  const fromParams = event.pathParameters?.["ticketId"];
  if (fromParams && TICKET_ID_RE.test(fromParams)) return fromParams;
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)\/belege$/);
  const candidate = m?.[1];
  if (candidate && TICKET_ID_RE.test(candidate)) return candidate;
  throw new AppError("ERR_VALIDATION", "ticketId path parameter is invalid");
}

function parseBelegIdFromKey(key: string): string {
  // Key shape: belege/<email-hash>/<ticketId>/<belegId>.<ext>
  const m = key.match(/\/([0-9A-HJKMNP-TV-Z]{26})\.[a-z0-9]+$/i);
  if (!m || !m[1]) {
    throw new AppError("ERR_INTERNAL", "could not parse belegId from presigned key");
  }
  return m[1];
}

export async function handlePostBelege(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const ticketId = extractTicketId(event);

    const body = readJsonBody(event);
    const parsed = belegPresignRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "belege presign body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `Ticket ${ticketId} not found`);
    }
    // Belege are only acceptable pre-submit. READY = post-extraction,
    // pre-/refund. VALIDATING = extraction still running. Past READY
    // the PDF is rendered and adding belege would not flow through.
    if (ticket.ticket_state !== "VALIDATING" && ticket.ticket_state !== "READY") {
      throw new AppError(
        "ERR_CONFLICT",
        "belege can only be added before refund submission",
        undefined,
        { current_state: ticket.ticket_state },
      );
    }

    const existing = await db().blobs.listReceipts(email, ticketId);
    if (existing.length >= 5) {
      throw new AppError("ERR_CONFLICT", "Max 5 belege per ticket");
    }

    const presigned = await db().blobs.presignReceiptPost(
      email,
      ticketId,
      parsed.data.mimeType,
    );
    const belegId = parseBelegIdFromKey(presigned.key);

    return okJson(200, {
      belegId,
      uploadUrl: presigned.url,
      s3_key: presigned.key,
      expiresIn: presigned.expiresIn,
      fields: presigned.fields,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
