// GET /users/me/route-templates
// - Bearer auth (USER only).
// - No pagination — route-templates have no cap and no cursor (locked
//   2026-06-18: "kein cap, kein TTL, lebt mit dem account"). The list is
//   bounded by user behaviour, admin-scale acceptable.
// - Response wrapper key is `templates` (not the generic `items`) per
//   D03 in API_CONTRACT_USERFORMS.md.
// - Repo sorts ascending by templateId (ULID = lexicographic = time-ordered).
//   We pass the order through unchanged.

import { db } from "@railback/lib/storage";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { toRouteTemplateView } from "./route-template-view.js";

export async function handleGetRouteTemplates(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const rows = await db().routeTemplates.list(email);
    return okJson(200, { templates: rows.map(toRouteTemplateView) });
  } catch (err) {
    return errorResponse(err);
  }
}
