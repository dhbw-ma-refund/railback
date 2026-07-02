// POST /users/me/tickets/{ticketId}/upload-confirm
// - Bearer auth (USER only).
// - Frontend calls this after a successful S3 POST against the presigned
//   policy from /upload. We finalise by writing the RAW# sibling-row
//   that holds the S3 metadata (filename, bucket, key, content_type,
//   size_bytes placeholder, uploaded_at).
// - **Locked 2026-06-24: the UserTicket and TicketOwner rows are NOT
//   written here anymore.** Both rows now live in `POST /upload`, before
//   the presign is returned, so the ticket-extractor's reverse lookup
//   (`PK=TICKET#<id>, SK=OWNER`) cannot race the S3 ObjectCreated event.
//   This handler is now blob-metadata-only.
// - Request body: { s3_key, filename, mimeType } via
//   uploadConfirmRequestSchema. There's deliberately no size_bytes
//   field — the frontend doesn't know it (S3 swallows the body) and
//   we don't fetch it sync. We persist 0 as a placeholder; the
//   ticket-extractor Lambda (S3 ObjectCreated trigger) will overwrite
//   the row with the real size pulled from the S3 event. Same
//   trade-off applies to the s3_bucket: in prod it comes from the
//   RAILBACK_S3_BUCKET env var, in tests it defaults to the in-memory
//   mock's "memory-mock" bucket name.
// - The s3_key is re-derived server-side from (email, ticketId, mime)
//   and the client-supplied key must match. Defends against a buggy or
//   hostile frontend pointing the RAW# row at another user's S3 object.
// - The UserTicket row MUST exist by the time this handler runs (it was
//   created by `POST /upload`). If it doesn't, that's a logic bug in
//   the frontend (confirmed without ever uploading) or a stale ticketId
//   — ERR_NOT_FOUND. The TicketOwner row is checked for cross-user
//   takeover the same way it was before (defensive; the /upload-side
//   check should already have caught it).
// - Idempotent retry: a second confirm for the same ticketId is a
//   no-op success that mirrors the current extraction_status.

import { uploadConfirmRequestSchema } from "@railback/lib/schemas/ticket";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { emailHash } from "@railback/lib";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

const TICKET_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function extFromMime(mime: string): string {
  // Matches mocks-in-memory/src/blobs.ts:extFromContentType and the
  // S3-side derivation in lib/src/storage/s3/blob-repo.ts. Single source
  // of truth would be nice; for now the duplicate is small + tested.
  switch (mime.toLowerCase()) {
    case "application/pdf": return "pdf";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    case "image/png": return "png";
    case "image/heic": return "heic";
    default: return "bin";
  }
}

function expectedRawKey(email: string, ticketId: string, mime: string): string {
  return `raw/${emailHash(email)}/${ticketId}.${extFromMime(mime)}`;
}

function extractTicketId(event: ApiGwEvent): string {
  const fromParams = event.pathParameters?.["ticketId"];
  if (fromParams && TICKET_ID_RE.test(fromParams)) return fromParams;
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/users\/me\/tickets\/([^/]+)\/upload-confirm$/);
  const candidate = m?.[1];
  if (candidate && TICKET_ID_RE.test(candidate)) return candidate;
  throw new AppError("ERR_VALIDATION", "ticketId path parameter is invalid");
}

function bucketName(): string {
  // Real bucket name comes from infra in Phase 5; the mock bucket name
  // matches MEMORY_BLOB_BUCKET in mocks-in-memory/src/blobs.ts.
  return process.env["RAILBACK_S3_BUCKET"] ?? "memory-mock";
}

export async function handlePostUploadConfirm(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const ticketId = extractTicketId(event);

    const body = readJsonBody(event);
    const parsed = uploadConfirmRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "upload-confirm body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // Idempotent retry: a second confirm for the same ticketId is a
    // no-op success that mirrors the current state. We still return
    // 202 — extraction is async; "accepted" reflects that.
    const existing = await db().tickets.get(email, ticketId);
    if (!existing) {
      // The UserTicket row should exist — it was created by /upload.
      // Reaching this branch means the frontend confirmed without ever
      // calling /upload, or against a stale/foreign ticketId.
      throw new AppError(
        "ERR_NOT_FOUND",
        "ticket not found — call POST /upload first to create the ticket and obtain a presigned URL",
        undefined,
        { ticketId },
      );
    }

    // Cross-user ownership-hijack defence: if a TicketOwner row exists
    // for this ticketId under a different email, refuse. /upload should
    // already have caught this; the duplicate check here is defence in
    // depth. The owner row MUST exist because /upload writes it
    // transactionally before the UserTicket row.
    const ownerLock = await db().ticketOwners.get(ticketId);
    if (ownerLock && ownerLock.email !== email) {
      throw new AppError(
        "ERR_CONFLICT",
        "ticketId is in use",
        undefined,
        { existing_ticket_id: ticketId },
      );
    }

    // Re-derive the canonical S3 key server-side and reject when the
    // client-supplied key doesn't match. The presigned-POST policy already
    // pins (bucket, key, Content-Type, content-length-range) so a non-
    // matching key means either a buggy frontend or an attempted cross-
    // ticket / cross-user write. Either way we don't want it on the row.
    const derivedKey = expectedRawKey(email, ticketId, parsed.data.mimeType);
    if (parsed.data.s3_key !== derivedKey) {
      throw new AppError(
        "ERR_VALIDATION",
        "s3_key does not match the expected raw-upload key for this ticket",
        undefined,
        { field: "s3_key" },
      );
    }

    // Idempotent: if a RAW# row already exists, this is a retry — return
    // the current state without rewriting. The UserTicket row's
    // extraction_status reflects what the extractor has done so far.
    const existingRaw = await db().blobs.getRawUpload(email, ticketId);
    if (existingRaw) {
      return okJson(202, {
        ticketId,
        extraction_status: existing.extraction_status,
      });
    }

    const uploadedAt = new Date().toISOString();
    // size_bytes = 0 placeholder — the S3-event-triggered extractor will
    // overwrite it with the real size once the object exists.
    await db().blobs.putRawUpload(email, ticketId, {
      filename: parsed.data.filename,
      s3_bucket: bucketName(),
      s3_key: derivedKey,
      content_type: parsed.data.mimeType,
      size_bytes: 0,
      uploaded_at: uploadedAt,
    });

    return okJson(202, {
      ticketId: existing.ticketId,
      extraction_status: existing.extraction_status,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
