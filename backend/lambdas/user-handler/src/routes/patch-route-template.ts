// PATCH /users/me/route-templates/{templateId}
// - Bearer auth (USER only).
// - Body: patchRouteTemplateRequestSchema (partial; at-least-one-field
//   enforced by the schema's .refine()).
// - If fromStation / toStation are in the patch, re-resolve EVA via
//   resolveStation. Both station-name and eva move together — we never
//   half-update one without the other.
// - 404 ERR_NOT_FOUND when the template doesn't exist for this user.
//   We do an explicit `get` first instead of relying on the repo's patch
//   to throw; that keeps the not-found vs. validation ordering deterministic
//   (validation always happens first; an auth'd user with a bad body never
//   leaks the existence/non-existence of a template).
// - templateId is immutable — schema doesn't carry it, so safeParse drops it.
// - 200 with the full RouteTemplateView after the patch lands.

import { patchRouteTemplateRequestSchema } from "@railback/lib/schemas/route-template";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { resolveStation } from "@railback/lib/refund/stations";
import type { RouteTemplatePatch } from "@railback/lib/types/dto";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { readTemplateIdParam, toRouteTemplateView } from "./route-template-view.js";

export async function handlePatchRouteTemplate(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const path = event.requestContext?.http?.path ?? event.rawPath ?? "";
    const templateId = readTemplateIdParam(event.pathParameters, path);
    if (!templateId) {
      throw new AppError("ERR_VALIDATION", "missing templateId in path");
    }

    const body = readJsonBody(event);
    const parsed = patchRouteTemplateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "route-template patch body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // Validation-first existence check — keeps the error-ordering
    // deterministic regardless of repo behaviour.
    const existing = await db().routeTemplates.get(email, templateId);
    if (!existing) {
      throw new AppError("ERR_NOT_FOUND", `Template ${templateId} not found`);
    }

    const patch: RouteTemplatePatch = {};
    if (parsed.data.label !== undefined) patch.label = parsed.data.label;
    if (parsed.data.fromStation !== undefined) {
      const from = resolveStation(parsed.data.fromStation);
      if (!from) {
        throw new AppError(
          "ERR_VALIDATION",
          "fromStation could not be resolved against the top-200 list",
          undefined,
          { field: "fromStation", value: parsed.data.fromStation },
        );
      }
      patch.from_station = from.name;
      patch.from_eva = from.eva;
    }
    if (parsed.data.toStation !== undefined) {
      const to = resolveStation(parsed.data.toStation);
      if (!to) {
        throw new AppError(
          "ERR_VALIDATION",
          "toStation could not be resolved against the top-200 list",
          undefined,
          { field: "toStation", value: parsed.data.toStation },
        );
      }
      patch.to_station = to.name;
      patch.to_eva = to.eva;
    }
    if (parsed.data.fahrkartennummer !== undefined) {
      patch.fahrkartennummer = parsed.data.fahrkartennummer;
    }
    if (parsed.data.fahrkartenpreis !== undefined) {
      patch.fahrkartenpreis = parsed.data.fahrkartenpreis;
    }
    if (parsed.data.zugkategorie_pref !== undefined) {
      patch.zugkategorie_pref = parsed.data.zugkategorie_pref;
    }

    const updated = await db().routeTemplates.patch(email, templateId, patch);
    return okJson(200, toRouteTemplateView(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
