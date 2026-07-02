// POST /admin/sepa/batches/{batchId}/mark-submitted
// - ADMIN-only. Empty body.
// - Flips every ISSUED mandate in the batch to SUBMITTED. Idempotent:
//   mandates already past SUBMITTED are skipped; mandates_marked counts
//   only the ones we actually flipped.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { markSubmittedRequestSchema } from "@railback/lib/schemas/admin";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";

function extractBatchId(event: ApiGwEvent): string {
  const fromParams = event.pathParameters?.["batchId"];
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
  const m = path.match(/^\/admin\/sepa\/batches\/([^/]+)\/mark-submitted$/);
  if (!m || !m[1]) {
    throw new AppError("ERR_VALIDATION", "batchId path parameter is missing");
  }
  return m[1];
}

export async function handleMarkSubmitted(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const batchId = extractBatchId(event);

    // Body is required to be `{}` — strict() rejects unknown keys.
    const body = readJsonBody(event) ?? {};
    const parsed = markSubmittedRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "mark-submitted body must be empty",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const mandates = await db().mandates.listByBatchId(batchId);
    if (mandates.length === 0) {
      throw new AppError("ERR_NOT_FOUND", `batch ${batchId} not found`);
    }

    const submittedAt = new Date().toISOString();
    let marked = 0;
    for (const m of mandates) {
      if (m.mandate_state === "ISSUED") {
        await db().mandates.markSubmitted(m.email, m.ticketId, submittedAt);
        marked++;
      }
    }

    // Idempotency: if we didn't flip anything this call, surface the
    // original submitted_at from an already-SUBMITTED mandate in this
    // batch — fresh `now` would misrepresent when the batch was actually
    // sent to the bank.
    let effectiveSubmittedAt = submittedAt;
    if (marked === 0) {
      const prior = mandates
        .map((m) => m.pain008_submitted_at)
        .find((s): s is string => typeof s === "string");
      if (prior) effectiveSubmittedAt = prior;
    }

    return okJson(200, {
      batchId,
      submitted_at: effectiveSubmittedAt,
      mandates_marked: marked,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
