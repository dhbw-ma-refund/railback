// Route templates — saved A→B routes for the MANUAL_ROUTE-ticket flow.
// No cap, no TTL; lives with the account. Per API_CONTRACT_USERFORMS.md D03.
//
// Wire shape uses camelCase for the route fields (fromStation, fromEva,
// toStation, toEva). Other fields (fahrkartennummer, fahrkartenpreis,
// zugkategorie_pref) stay snake_case so they mirror the matching fields
// on the ticket/refund payloads. createRequest does NOT carry from/toEva
// — the backend resolves those from the *Station names via the bundled
// top-200 list, same resolver as POST /route-lookup uses.
//
// Response wrapper for the list endpoint is { templates: [...] }, NOT the
// generic { items: [...] } used by paginated admin endpoints — route-
// templates don't paginate (no cap, no cursor).

import { z } from "zod";
import { iso8601DateTimeSchema, ulidSchema } from "./common.js";

export const routeTemplateSchema = z
  .object({
    templateId: ulidSchema,
    label: z.string().min(1),
    fromStation: z.string().min(1),
    fromEva: z.number().int().positive(),
    toStation: z.string().min(1),
    toEva: z.number().int().positive(),
    fahrkartennummer: z.string().optional(),
    fahrkartenpreis: z.string().optional(),
    zugkategorie_pref: z.string().optional(),
    created_at: iso8601DateTimeSchema,
    updated_at: iso8601DateTimeSchema,
  })
  .openapi("RouteTemplate", {
    description:
      "Saved A→B route for the MANUAL_ROUTE-ticket flow. No cap, no TTL.",
  });
export type RouteTemplateView = z.infer<typeof routeTemplateSchema>;

export const listRouteTemplatesResponseSchema = z
  .object({
    templates: z.array(routeTemplateSchema),
  })
  .openapi("ListRouteTemplatesResponse", {
    description: "GET /users/me/route-templates.",
  });
export type ListRouteTemplatesResponse = z.infer<
  typeof listRouteTemplatesResponseSchema
>;

export const getRouteTemplateResponseSchema = routeTemplateSchema;
export type GetRouteTemplateResponse = z.infer<
  typeof getRouteTemplateResponseSchema
>;

// POST /users/me/route-templates — frontend allocates templateId.
// fromStation / toStation are free text; backend resolves them via the
// top-200 list. fromEva / toEva are NOT in the request body.
export const createRouteTemplateRequestSchema = z.object({
  templateId: ulidSchema,
  label: z.string().min(1),
  fromStation: z.string().min(1),
  toStation: z.string().min(1),
  fahrkartennummer: z.string().optional(),
  fahrkartenpreis: z.string().optional(),
  zugkategorie_pref: z.string().optional(),
});
export type CreateRouteTemplateRequest = z.infer<
  typeof createRouteTemplateRequestSchema
>;

// PATCH — partial; templateId is immutable so it's never in the body.
export const patchRouteTemplateRequestSchema = z
  .object({
    label: z.string().min(1).optional(),
    fromStation: z.string().min(1).optional(),
    toStation: z.string().min(1).optional(),
    fahrkartennummer: z.string().optional(),
    fahrkartenpreis: z.string().optional(),
    zugkategorie_pref: z.string().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "at least one field must be provided",
  });
export type PatchRouteTemplateRequest = z.infer<
  typeof patchRouteTemplateRequestSchema
>;
