// POST /admin/sepa/reports/upload
// - ADMIN-only.
// - Issues a presigned-POST to sepa-reports/<YYYY-MM-DD>/<reportId>.xml.
//   Cap 5 MB, content-type pinned. S3 PutObject on this prefix triggers
//   the sepa-reports Lambda (Phase 2.10).
// - This handler does NOT create a SepaReport row — the report Lambda
//   parses the XML and writes the row on its side. We only issue the URL.

import { AppError } from "@railback/lib/errors";
import { ulid } from "@railback/lib/util/ulid";
import { presignPost } from "@railback/lib/storage/s3/presigned-post";
import { sepaReportUploadRequestSchema } from "@railback/lib/schemas/admin";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";

const SEPA_REPORT_MAX_BYTES = 5 * 1024 * 1024;
const PRESIGN_TTL_SEC = 300;

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function handleSepaReportUpload(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);

    const body = readJsonBody(event);
    const parsed = sepaReportUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "upload body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }
    if (parsed.data.size_bytes > SEPA_REPORT_MAX_BYTES) {
      throw new AppError(
        "ERR_VALIDATION",
        `report exceeds ${SEPA_REPORT_MAX_BYTES} bytes`,
        undefined,
        { field: "size_bytes" },
      );
    }

    const bucket = process.env["RAILBACK_S3_BUCKET"];
    if (!bucket) {
      throw new AppError(
        "ERR_INTERNAL",
        "RAILBACK_S3_BUCKET not set; cannot issue upload URLs",
      );
    }

    const reportId = ulid();
    const key = `sepa-reports/${todayIsoDate()}/${reportId}.xml`;
    const presigned = await presignPost({
      bucket,
      key,
      contentType: parsed.data.content_type,
      maxBytes: SEPA_REPORT_MAX_BYTES,
      expiresInSec: PRESIGN_TTL_SEC,
    });

    return okJson(200, {
      url: presigned.url,
      fields: presigned.fields,
      expires_in: presigned.expiresIn,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
