// GET /admin/stats
// - ADMIN-only. 30 s in-process cache (see stats-cache.ts).

import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireAdminCaller } from "../auth-context.js";
import { getStatsSnapshot } from "../stats-cache.js";

export async function handleGetStats(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    requireAdminCaller(event);
    const snapshot = await getStatsSnapshot();
    return okJson(200, snapshot);
  } catch (err) {
    return errorResponse(err);
  }
}
