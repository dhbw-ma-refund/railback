// user-handler entry point.
//
// Part 1 routes (Phase 2.2):
//   GET    /users/me                       → profile
//   PATCH  /users/me                       → profile update (partial)
//   GET    /users/me/refund-data           → EU-form field set incl. decrypted IBAN/BIC
//   PATCH  /users/me/bank                  → IBAN/BIC update (both together)
//   DELETE /users/me                       → self-delete (confirmPassword required)
//
// Part 2 routes (Phase 2.3) — ticket / refund / belege / route-templates:
//   GET    /users/me/tickets                                      → list tickets
//   GET    /users/me/tickets/{ticketId}                           → single ticket
//   DELETE /users/me/tickets/{ticketId}                           → soft-delete (→ INVALID + TTL 90d)
//   POST   /users/me/tickets/{ticketId}/upload                    → presigned POST for raw upload
//   POST   /users/me/tickets/{ticketId}/upload-confirm            → land RAW# + create Ticket
//   POST   /users/me/tickets/route-lookup                         → stateless route candidates
//   POST   /users/me/tickets/from-route                           → create MANUAL_ROUTE ticket in READY
//   POST   /users/me/tickets/{ticketId}/delays                    → segment-delays lookup for THIS ticket
//   POST   /users/me/tickets/{ticketId}/refund                    → submit refund (locks fee, mandate, → EMAIL_SENDING)
//   POST   /users/me/tickets/{ticketId}/belege                    → presigned POST for a beleg
//   POST   /users/me/tickets/{ticketId}/belege/{belegId}/confirm  → land beleg metadata + bump count
//   DELETE /users/me/tickets/{ticketId}/belege/{belegId}          → remove a pre-submission beleg
//   GET    /users/me/route-templates                              → list saved templates
//   POST   /users/me/route-templates                              → create (frontend-allocated ULID)
//   PATCH  /users/me/route-templates/{templateId}                 → partial update
//   DELETE /users/me/route-templates/{templateId}                 → delete
//
// All routes require a Bearer token with role=USER. Admins logging in
// via the same /auth/login endpoint get a role=ADMIN token which the
// per-route requireUserCaller() rejects with ERR_FORBIDDEN.
//
// Path-parameter extraction: API Gateway HTTP API v2 already populates
// event.pathParameters when the route is registered with placeholders.
// In the test harness we don't always have that, so each route also
// has a regex fallback against the raw path. The dispatcher below
// matches plain prefixes first, then template paths; for template
// paths it mutates event.pathParameters before delegating so the
// downstream route can read params uniformly.
//
// ⚠ DEPLOY-GAP (Phase 2.2 / 2.3, will land in Phase 5):
//   Same as auth-handler — the production handler imports `db()` but
//   does NOT side-effect-register a storage backend. Tests work because
//   test/setup.ts imports @railback/mocks-in-memory. Real Lambda
//   cold-start would throw ERR_INTERNAL "no factory registered". See
//   BUILD.md for the full plan.

import { AppError } from "@railback/lib/errors";
import type { ApiGwEvent, ApiGwResponse } from "./event.js";
import { errorResponse } from "./response.js";

// Part 1 routes
import { handleGetMe } from "./routes/get-me.js";
import { handlePatchMe } from "./routes/patch-me.js";
import { handleGetRefundData } from "./routes/get-refund-data.js";
import { handlePatchBank } from "./routes/patch-bank.js";
import { handleDeleteMe } from "./routes/delete-me.js";

// Part 2 — ticket CRUD
import { handleGetTickets } from "./routes/get-tickets.js";
import { handleGetTicket } from "./routes/get-ticket.js";
import { handleDeleteTicket } from "./routes/delete-ticket.js";

// Part 2 — upload
import { handlePostUpload } from "./routes/post-upload.js";
import { handlePostUploadConfirm } from "./routes/post-upload-confirm.js";

// Part 2 — MANUAL_ROUTE
import { handlePostRouteLookup } from "./routes/post-route-lookup.js";
import { handlePostFromRoute } from "./routes/post-from-route.js";

// Part 2 — delays + refund
import { handlePostDelays } from "./routes/post-delays.js";
import { handlePostRefund } from "./routes/post-refund.js";

// Part 2 — belege
import { handlePostBelege } from "./routes/post-belege.js";
import { handlePostBelegeConfirm } from "./routes/post-belege-confirm.js";
import { handleDeleteBeleg } from "./routes/delete-beleg.js";

// Part 2 — route-templates
import { handleGetRouteTemplates } from "./routes/get-route-templates.js";
import { handlePostRouteTemplate } from "./routes/post-route-template.js";
import { handlePatchRouteTemplate } from "./routes/patch-route-template.js";
import { handleDeleteRouteTemplate } from "./routes/delete-route-template.js";

type Route = (event: ApiGwEvent) => Promise<ApiGwResponse>;

interface TemplateMatch {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Route;
}

// Order matters: more specific patterns BEFORE more general ones with
// the same prefix (e.g. /tickets/route-lookup must be tried before any
// /tickets/{ticketId}/... pattern).
const TEMPLATE_ROUTES: TemplateMatch[] = [
  // Stateless / non-id routes that share the /tickets/ prefix — list these
  // first so the dispatcher doesn't capture "route-lookup" as a ticketId.
  { method: "POST", pattern: /^\/users\/me\/tickets\/route-lookup$/, paramNames: [], handler: handlePostRouteLookup },
  { method: "POST", pattern: /^\/users\/me\/tickets\/from-route$/, paramNames: [], handler: handlePostFromRoute },

  // Ticket-id-keyed routes — beleg sub-routes BEFORE the bare /tickets/{id} routes
  // (longer pattern first).
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/belege\/([^/]+)\/confirm$/, paramNames: ["ticketId", "belegId"], handler: handlePostBelegeConfirm },
  { method: "DELETE", pattern: /^\/users\/me\/tickets\/([^/]+)\/belege\/([^/]+)$/,         paramNames: ["ticketId", "belegId"], handler: handleDeleteBeleg },
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/belege$/,                  paramNames: ["ticketId"],             handler: handlePostBelege },
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/upload$/,                  paramNames: ["ticketId"],             handler: handlePostUpload },
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/upload-confirm$/,          paramNames: ["ticketId"],             handler: handlePostUploadConfirm },
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/delays$/,                  paramNames: ["ticketId"],             handler: handlePostDelays },
  { method: "POST",   pattern: /^\/users\/me\/tickets\/([^/]+)\/refund$/,                  paramNames: ["ticketId"],             handler: handlePostRefund },
  { method: "GET",    pattern: /^\/users\/me\/tickets\/([^/]+)$/,                          paramNames: ["ticketId"],             handler: handleGetTicket },
  { method: "DELETE", pattern: /^\/users\/me\/tickets\/([^/]+)$/,                          paramNames: ["ticketId"],             handler: handleDeleteTicket },

  // Route-templates with id
  { method: "PATCH",  pattern: /^\/users\/me\/route-templates\/([^/]+)$/, paramNames: ["templateId"], handler: handlePatchRouteTemplate },
  { method: "DELETE", pattern: /^\/users\/me\/route-templates\/([^/]+)$/, paramNames: ["templateId"], handler: handleDeleteRouteTemplate },
];

function matchTemplate(method: string, path: string): { handler: Route; params: Record<string, string> } | undefined {
  for (const r of TEMPLATE_ROUTES) {
    if (r.method !== method) continue;
    const m = path.match(r.pattern);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.paramNames.forEach((name, i) => {
      const v = m[i + 1];
      if (v !== undefined) params[name] = v;
    });
    return { handler: r.handler, params };
  }
  return undefined;
}

export async function handler(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase() ?? "";
    const path = event.requestContext?.http?.path ?? event.rawPath ?? "";

    // Part 1 — static profile / refund-data / bank / self-delete.
    if (path === "/users/me") {
      if (method === "GET") return handleGetMe(event);
      if (method === "PATCH") return handlePatchMe(event);
      if (method === "DELETE") return handleDeleteMe(event);
    }
    if (path === "/users/me/refund-data" && method === "GET") {
      return handleGetRefundData(event);
    }
    if (path === "/users/me/bank" && method === "PATCH") {
      return handlePatchBank(event);
    }

    // Part 2 — static collection routes (must precede template matches).
    if (path === "/users/me/tickets" && method === "GET") {
      return handleGetTickets(event);
    }
    if (path === "/users/me/route-templates") {
      if (method === "GET") return handleGetRouteTemplates(event);
      if (method === "POST") return handlePostRouteTemplate(event);
    }

    // Part 2 — template / path-param routes.
    const match = matchTemplate(method, path);
    if (match) {
      // Merge the extracted path params with anything API Gateway already
      // provided (route-key placeholders win, but in our test harness
      // they're usually absent).
      event.pathParameters = { ...(event.pathParameters ?? {}), ...match.params };
      return match.handler(event);
    }

    return errorResponse(
      new AppError("ERR_NOT_FOUND", `route ${method || "?"} ${path} not found`),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
