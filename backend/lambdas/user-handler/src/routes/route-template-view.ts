// Shared snake_case-DTO → camelCase-wire mapper for route-template routes.
// - The RouteTemplate DTO (lib/src/types/dto.ts) uses snake_case for route
//   fields (from_station / from_eva / to_station / to_eva) to mirror the DDB
//   item layout.
// - The wire schema (lib/src/schemas/route-template.ts) uses camelCase per
//   the userforms API contract (D03).
// - All four CRUD routes go through this mapper at the response boundary so
//   the shape on the wire is consistent and we never accidentally leak the
//   DDB-shaped fields.
// - omit-undefined for the three optional fields so they're absent from the
//   JSON instead of `null` — exactOptionalPropertyTypes-friendly and matches
//   the wire-schema (which marks them `.optional()`, not `.nullable()`).

import type { RouteTemplate } from "@railback/lib/types/dto";
import type { RouteTemplateView } from "@railback/lib/schemas/route-template";

export function toRouteTemplateView(t: RouteTemplate): RouteTemplateView {
  const view: RouteTemplateView = {
    templateId: t.templateId,
    label: t.label,
    fromStation: t.from_station,
    fromEva: t.from_eva,
    toStation: t.to_station,
    toEva: t.to_eva,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
  if (t.fahrkartennummer !== undefined) view.fahrkartennummer = t.fahrkartennummer;
  if (t.fahrkartenpreis !== undefined) view.fahrkartenpreis = t.fahrkartenpreis;
  if (t.zugkategorie_pref !== undefined) view.zugkategorie_pref = t.zugkategorie_pref;
  return view;
}

/**
 * Pull a path parameter off the API GW event. The dispatcher in handler.ts
 * pre-extracts these into `pathParameters`; we fall back to the last
 * path segment so direct (test-time) invocations without dispatcher
 * pre-processing still work.
 */
export function readTemplateIdParam(
  pathParameters: Record<string, string | undefined> | undefined,
  path: string,
): string | null {
  const fromParams = pathParameters?.["templateId"];
  if (fromParams && fromParams.length > 0) return fromParams;
  // Fall back: /users/me/route-templates/<id>[/...] — last non-empty
  // segment past the collection root.
  const marker = "/route-templates/";
  const idx = path.indexOf(marker);
  if (idx < 0) return null;
  const tail = path.slice(idx + marker.length).split("/")[0];
  return tail && tail.length > 0 ? tail : null;
}
