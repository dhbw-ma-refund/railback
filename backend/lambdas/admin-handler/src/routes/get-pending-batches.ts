// GET /admin/sepa/pending-batches
// - ADMIN-only.
// - Groups MandateRepo.listPendingBatches() output by pain008_batch_id
//   and issues a presigned GET URL per batch for the pain.008 XML
//   download.
// - "Pending" = mandate_state == ISSUED AND pain008_built_at set AND
//   pain008_submitted_at not set (the MandateRepo handles the filter).

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { presignGet } from "@railback/lib/storage/s3/presigned-get";
import { sumDecimals } from "@railback/lib/util/decimal";
import type { SepaMandate } from "@railback/lib/types/dto";

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { pendingBatchView } from "../projections.js";

const DOWNLOAD_TTL_SEC = 300;

export async function handleGetPendingBatches(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);

    const bucket = process.env["RAILBACK_S3_BUCKET"];
    if (!bucket) {
      throw new AppError(
        "ERR_INTERNAL",
        "RAILBACK_S3_BUCKET not set; cannot issue download URLs",
      );
    }

    const mandates = await db().mandates.listPendingBatches();

    // Group by batch_id. Skip mandates that have no batch id (defensive —
    // listPendingBatches filter already requires pain008_built_at, which
    // is set in the same transaction as the batch_id).
    const groups = new Map<string, SepaMandate[]>();
    for (const m of mandates) {
      const id = m.pain008_batch_id;
      if (!id) continue;
      const arr = groups.get(id);
      if (arr) arr.push(m);
      else groups.set(id, [m]);
    }

    const items = await Promise.all(
      [...groups.entries()].map(async ([batchId, ms]) => {
        const first = ms[0];
        if (!first) {
          throw new AppError("ERR_INTERNAL", "empty mandate group for batch");
        }
        const s3Key = first.pain008_s3_key;
        if (!s3Key) {
          throw new AppError(
            "ERR_INTERNAL",
            `mandate ${first.mandate_id} has pain008_batch_id without pain008_s3_key`,
          );
        }
        const builtAt = first.pain008_built_at;
        if (!builtAt) {
          throw new AppError(
            "ERR_INTERNAL",
            `mandate ${first.mandate_id} missing pain008_built_at`,
          );
        }
        const totalEur = sumDecimals(ms.map((x) => x.fee_amount));
        const { url, expiresIn } = await presignGet({
          bucket,
          key: s3Key,
          expiresInSec: DOWNLOAD_TTL_SEC,
        });
        return pendingBatchView({
          batchId,
          s3_key: s3Key,
          downloadUrl: url,
          downloadUrlExpiresIn: expiresIn,
          mandate_count: ms.length,
          total_eur: totalEur,
          built_at: builtAt,
        });
      }),
    );

    return okJson(200, { items });
  } catch (err) {
    return errorResponse(err);
  }
}
