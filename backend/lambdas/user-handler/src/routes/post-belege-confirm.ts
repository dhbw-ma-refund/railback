// POST /users/me/tickets/{ticketId}/belege/{belegId}/confirm
// - Bearer auth (USER only). Caller must own the ticket.
// - Frontend has POSTed bytes directly to S3 via the presigned-POST
//   URL; now it tells us what landed. We persist the metadata row and
//   bump ticket.belege_count.
// - Body: belegConfirmRequestSchema — { s3_key, filename, mimeType,
//   typ, size_bytes }. size_bytes is required: even though the S3
//   policy enforces the 5 MB cap, we need the value on the row for
//   pain.008-time reconciliation + future admin views.
// - 409 if the ticket is past READY (race with /refund-submit).
// - The blob repo enforces both the 5-beleg cap and the 5 MB per-file
//   cap; we let those AppErrors bubble up.

import { belegConfirmRequestSchema } from "@railback/lib/schemas/ticket";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

const TICKET_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const BUCKET = process.env["RAILBACK_S3_BUCKET"] ?? "memory-mock";

function parseBelegIdFromKey(key: string): string | null {
  // Mirrors the post-belege regex: belege/<email-hash>/<ticketId>/<belegId>.<ext>
  const m = key.match(/\/([0-9A-HJKMNP-TV-Z]{26})\.[a-z0-9]+$/i);
  return m?.[1] ?? null;
}

function extractPathIds(event: ApiGwEvent): { ticketId: string; belegId: string } {
  const fromParams = event.pathParameters ?? {};
  const tFromParams = fromParams["ticketId"];
  const bFromParams = fromParams["belegId"];
  if (
    tFromParams && TICKET_ID_RE.test(tFromParams) &&
    bFromParams && ULID_RE.test(bFromParams)
  ) {
    return { ticketId: tFromParams, belegId: bFromParams };
  }
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(
    /^\/users\/me\/tickets\/([^/]+)\/belege\/([^/]+)\/confirm$/,
  );
  const t = m?.[1];
  const b = m?.[2];
  if (t && TICKET_ID_RE.test(t) && b && ULID_RE.test(b)) {
    return { ticketId: t, belegId: b };
  }
  throw new AppError(
    "ERR_VALIDATION",
    "ticketId or belegId path parameter is invalid",
  );
}

export async function handlePostBelegeConfirm(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const { ticketId, belegId } = extractPathIds(event);

    const body = readJsonBody(event);
    const parsed = belegConfirmRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "belege confirm body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const ticket = await db().tickets.get(email, ticketId);
    if (!ticket) {
      throw new AppError("ERR_NOT_FOUND", `Ticket ${ticketId} not found`);
    }
    if (ticket.ticket_state !== "VALIDATING" && ticket.ticket_state !== "READY") {
      throw new AppError(
        "ERR_CONFLICT",
        "belege can only be added before refund submission",
        undefined,
        { current_state: ticket.ticket_state },
      );
    }

    // The s3_key carries the belegId embedded by presignReceiptPost (shape
    // belege/<email-hash>/<ticketId>/<belegId>.<ext>). Assert it matches
    // the belegId from the URL so a misbehaving / hostile client can't
    // persist a row whose primary key disagrees with its bytes — that
    // would let the EU-form merge in the wrong content and leave bytes
    // un-deletable later.
    const keyBelegId = parseBelegIdFromKey(parsed.data.s3_key);
    if (keyBelegId !== belegId) {
      throw new AppError(
        "ERR_VALIDATION",
        "belegId in s3_key does not match the URL belegId",
        undefined,
        { field: "s3_key" },
      );
    }

    await db().blobs.putReceipt(email, ticketId, {
      belegId,
      filename: parsed.data.filename,
      s3_bucket: BUCKET,
      s3_key: parsed.data.s3_key,
      content_type: parsed.data.mimeType,
      size_bytes: parsed.data.size_bytes,
      typ: parsed.data.typ,
      amount: parsed.data.amount,
      uploaded_at: new Date().toISOString(),
    });

    // Bump belege_count from current ticket state.
    const newCount = (ticket.belege_count ?? 0) + 1;
    await db().tickets.patch(email, ticketId, { belege_count: newCount });

    return okJson(200, { belegId });
  } catch (err) {
    return errorResponse(err);
  }
}
