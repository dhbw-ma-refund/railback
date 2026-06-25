// POST /users/me/tickets/{ticketId}/upload
// - Bearer auth (USER only).
// - ticketId is a path param. Frontend allocates the ULID client-side
//   and re-posts on retry with the same id; this call is idempotent.
// - Request body: { filename, mimeType } — validated via
//   uploadRequestSchema.
// - Locked 2026-06-18: we issue a presigned POST (not PUT). POST is
//   the only S3 verb that lets the policy enforce content-length-range
//   server-side (PUT signatures bind only method+key+Content-Type).
//   Without that we'd need a HeadObject + Delete cleanup loop for
//   oversize uploads, which is racy and slow.
// - **Locked 2026-06-24: this handler now writes the `TicketOwner` and
//   `UserTicket(VALIDATING, extraction_status=PROCESSING)` rows BEFORE
//   returning the presign.** Per DB_SCHEMA.md "Ticket Owner — No race in
//   the create path", both rows must exist before the S3 ObjectCreated
//   event can fire so the `ticket-extractor` Lambda's reverse lookup
//   (`GetItem PK=TICKET#<id>, SK=OWNER` → email → `UserTicket`) never
//   misses. Previously the rows were written in `upload-confirm`, which
//   races against the S3 event. The `RAW#` sibling row remains
//   upload-confirm's job — it carries the post-PUT metadata and is not
//   on the extractor's critical path.
// - Conflict rule: if a ticket with this ticketId already exists for
//   the caller, a fresh presign is only allowed while extraction is
//   still pending (ticket_state === VALIDATING and extraction_method
//   !== MANUAL_ROUTE). Once the ticket has moved on, a re-upload would
//   either clobber a finished extraction or be meaningless against a
//   route-template-ticket that has no upload at all → ERR_CONFLICT.
// - Cross-user ownership-hijack defence: a TicketOwner row under a
//   different email for the same ticketId → ERR_CONFLICT. Mirrors the
//   same check the old `upload-confirm` carried.
// - Idempotency: re-posting the same ticketId by the same user is a
//   no-op (existing rows are reused, only the presign is freshly issued
//   so the 5 min URL TTL is reset).

import { uploadRequestSchema } from "@railback/lib/schemas/ticket";
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
  // Fallback: parse out of the raw path so the route works even when
  // the dispatcher hasn't pre-extracted path params.
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)\/upload$/);
  const candidate = m?.[1];
  if (candidate && TICKET_ID_RE.test(candidate)) return candidate;
  throw new AppError("ERR_VALIDATION", "ticketId path parameter is invalid");
}

export async function handlePostUpload(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const ticketId = extractTicketId(event);

    const body = readJsonBody(event);
    const parsed = uploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "upload body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // If the ticket already exists and it's no longer awaiting extraction,
    // refuse a fresh presign. A pending VALIDATING ticket is fine — that's
    // the resume-after-flaky-network case the frontend retries against.
    const existing = await db().tickets.get(email, ticketId);
    if (existing) {
      const isPending =
        existing.ticket_state === "VALIDATING" &&
        existing.extraction_method !== "MANUAL_ROUTE";
      if (!isPending) {
        throw new AppError(
          "ERR_CONFLICT",
          "ticket already finalised — upload not allowed",
          undefined,
          {
            existing_ticket_id: existing.ticketId,
            current_state: existing.ticket_state,
            extraction_method: existing.extraction_method,
          },
        );
      }
    }

    // Cross-user ownership-hijack defence (locked 2026-06-20): if a
    // TicketOwner row exists for this ticketId under a different email,
    // refuse. Without this UserB could pre-claim a ticketId already in
    // use by UserA.
    const ownerLock = await db().ticketOwners.get(ticketId);
    if (ownerLock && ownerLock.email !== email) {
      throw new AppError(
        "ERR_CONFLICT",
        "ticketId is in use",
        undefined,
        { existing_ticket_id: ticketId },
      );
    }

    const presigned = await db().blobs.presignRawUploadPost(
      email,
      ticketId,
      parsed.data.mimeType,
    );

    // Write TicketOwner + UserTicket BEFORE returning the presign so the
    // extractor's reverse-lookup never races the S3 ObjectCreated event.
    // Order: owner first (cheap pre-condition for the rest of the
    // ticket lifecycle), then UserTicket. Both writes are skipped if
    // `existing` was non-null above — that path is the resume case where
    // the rows already exist from the first /upload call.
    if (!existing) {
      const uploadedAt = new Date().toISOString();
      await db().ticketOwners.put(ticketId, email);
      await db().tickets.create({
        email,
        ticketId,
        filename: parsed.data.filename,
        s3_key: presigned.key,
        mimeType: parsed.data.mimeType,
        contentType: parsed.data.mimeType,
        sizeBytes: 0,
        uploadedAt,
      });
    }

    return okJson(200, {
      ticketId,
      uploadUrl: presigned.url,
      s3_key: presigned.key,
      expiresIn: presigned.expiresIn,
      fields: presigned.fields,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
