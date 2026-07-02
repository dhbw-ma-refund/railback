// POST /users/me/route-templates
// - Bearer auth (USER only).
// - Body: createRouteTemplateRequestSchema. templateId is frontend-
//   allocated (ULID); duplicate writes throw ERR_CONFLICT from the repo.
// - fromStation / toStation are free text — resolved against the bundled
//   top-200 list via @railback/lib/refund/stations.resolveStation. The
//   wire body intentionally does NOT carry fromEva / toEva; the backend
//   fills both. Mirrors the route-lookup behaviour.
// - If either station fails to resolve → ERR_VALIDATION with the offending
//   field surfaced in details. Frontend renders the bundled top-200 list
//   as autocomplete so this is mostly defence in depth.
// - 201 with the full RouteTemplateView (camelCase wire shape).

import { createRouteTemplateRequestSchema } from "@railback/lib/schemas/route-template";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { resolveStation } from "@railback/lib/refund/stations";
import type { NewRouteTemplate } from "@railback/lib/types/dto";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { toRouteTemplateView } from "./route-template-view.js";

export async function handlePostRouteTemplate(
  event: ApiGwEvent,
): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = createRouteTemplateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "route-template create body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const from = resolveStation(parsed.data.fromStation);
    if (!from) {
      throw new AppError(
        "ERR_VALIDATION",
        `fromStation could not be resolved against the top-200 list`,
        undefined,
        { field: "fromStation", value: parsed.data.fromStation },
      );
    }
    const to = resolveStation(parsed.data.toStation);
    if (!to) {
      throw new AppError(
        "ERR_VALIDATION",
        `toStation could not be resolved against the top-200 list`,
        undefined,
        { field: "toStation", value: parsed.data.toStation },
      );
    }

    const tpl: NewRouteTemplate = {
      templateId: parsed.data.templateId,
      label: parsed.data.label,
      from_station: from.name,
      from_eva: from.eva,
      to_station: to.name,
      to_eva: to.eva,
    };
    if (parsed.data.fahrkartennummer !== undefined) {
      tpl.fahrkartennummer = parsed.data.fahrkartennummer;
    }
    if (parsed.data.fahrkartenpreis !== undefined) {
      tpl.fahrkartenpreis = parsed.data.fahrkartenpreis;
    }
    if (parsed.data.zugkategorie_pref !== undefined) {
      tpl.zugkategorie_pref = parsed.data.zugkategorie_pref;
    }

    // Repo throws ERR_CONFLICT on duplicate templateId.
    const created = await db().routeTemplates.create(email, tpl);
    return okJson(201, toRouteTemplateView(created));
  } catch (err) {
    return errorResponse(err);
  }
}
