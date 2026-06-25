// DELETE /users/me/route-templates/{templateId}
// - Bearer auth (USER only).
// - 204 No Content on success.
// - Decision: return 404 when the template doesn't exist for this user
//   (matches the GET/PATCH convention; the underlying repo.delete is a
//   silent no-op, so we do an explicit `get` first). CLAUDE.md doesn't
//   pin this either way — picking the 404 path keeps all four CRUD
//   routes consistent in their not-found behaviour and avoids hiding
//   a frontend bug where the same delete is fired twice in flight.
// - Tickets created from this template earlier are unaffected (no FK
//   from ticket → template; the route was snapshotted at ticket-create).

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { errorResponse, noContent } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { readTemplateIdParam } from "./route-template-view.js";

export async function handleDeleteRouteTemplate(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
    const templateId = readTemplateIdParam(event.pathParameters, path);
    if (!templateId) {
      throw new AppError("ERR_VALIDATION", "missing templateId in path");
    }

    const existing = await db().routeTemplates.get(email, templateId);
    if (!existing) {
      throw new AppError("ERR_NOT_FOUND", `Template ${templateId} not found`);
    }

    await db().routeTemplates.delete(email, templateId);
    return noContent();
  } catch (err) {
    return errorResponse(err);
  }
}
