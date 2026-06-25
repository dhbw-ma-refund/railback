// admin-handler entry point.
//
// Routes (Phase 2.4):
//   GET    /admin/stats
//   GET    /admin/users
//   GET    /admin/users/{email}
//   PATCH  /admin/users/{email}
//   GET    /admin/tickets
//   GET    /admin/tickets/{ticketId}
//   PATCH  /admin/tickets/{ticketId}
//   GET    /admin/trains/{trainNr}/{date}/delays
//   GET    /admin/sepa/pending-batches
//   POST   /admin/sepa/batches/{batchId}/mark-submitted
//   POST   /admin/sepa/reports/upload
//
// All routes require a Bearer token with role=ADMIN. USER tokens are
// rejected with ERR_FORBIDDEN by requireAdminCaller().
//
// Path-parameter extraction: API Gateway HTTP API v2 already populates
// event.pathParameters when the route is registered with placeholders.
// In the test harness pathParameters can be absent, so each per-route
// handler also has a regex fallback against the raw path. The dispatcher
// below matches static paths first, then templates; for template paths
// it mutates event.pathParameters before delegating so the downstream
// route can read params uniformly.
//
// ⚠ DEPLOY-GAP (Phase 2.4, will land in Phase 5):
//   Same gap as user-handler / auth-handler. The production handler
//   imports `db()` from @railback/lib/storage but does NOT
//   side-effect-register a storage backend. Tests work because
//   test/setup.ts imports @railback/mocks-in-memory. Real Lambda
//   cold-start would throw ERR_INTERNAL "no factory registered". See
//   BUILD.md.

import { AppError } from "@railback/lib/errors";
import type { ApiGwEvent, ApiGwResponse } from "./event.js";
import { errorResponse } from "./response.js";

import { handleGetStats } from "./routes/get-stats.js";
import { handleGetUsers } from "./routes/get-users.js";
import { handleGetUser } from "./routes/get-user.js";
import { handlePatchUser } from "./routes/patch-user.js";
import { handleGetTickets } from "./routes/get-tickets.js";
import { handleGetTicket } from "./routes/get-ticket.js";
import { handlePatchTicket } from "./routes/patch-ticket.js";
import { handleGetTrainDelays } from "./routes/get-train-delays.js";
import { handleGetPendingBatches } from "./routes/get-pending-batches.js";
import { handleMarkSubmitted } from "./routes/post-mark-submitted.js";
import { handleSepaReportUpload } from "./routes/post-sepa-report-upload.js";

type Route = (event: ApiGwEvent) => Promise<ApiGwResponse>;

interface TemplateMatch {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Route;
}

// Order matters: most-specific patterns BEFORE more general ones.
const TEMPLATE_ROUTES: TemplateMatch[] = [
  // SEPA — specific paths before the generic /sepa/* family.
  {
    method: "POST",
    pattern: /^\/admin\/sepa\/batches\/([^/]+)\/mark-submitted$/,
    paramNames: ["batchId"],
    handler: handleMarkSubmitted,
  },
  // Trains
  {
    method: "GET",
    pattern: /^\/admin\/trains\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/delays$/,
    paramNames: ["trainNr", "date"],
    handler: handleGetTrainDelays,
  },
  // Tickets by id
  {
    method: "GET",
    pattern: /^\/admin\/tickets\/([^/]+)$/,
    paramNames: ["ticketId"],
    handler: handleGetTicket,
  },
  {
    method: "PATCH",
    pattern: /^\/admin\/tickets\/([^/]+)$/,
    paramNames: ["ticketId"],
    handler: handlePatchTicket,
  },
  // Users by email
  {
    method: "GET",
    pattern: /^\/admin\/users\/([^/]+)$/,
    paramNames: ["email"],
    handler: handleGetUser,
  },
  {
    method: "PATCH",
    pattern: /^\/admin\/users\/([^/]+)$/,
    paramNames: ["email"],
    handler: handlePatchUser,
  },
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

    // Static collection routes — must precede template matches.
    if (path === "/admin/stats" && method === "GET") return handleGetStats(event);
    if (path === "/admin/users" && method === "GET") return handleGetUsers(event);
    if (path === "/admin/tickets" && method === "GET") return handleGetTickets(event);
    if (path === "/admin/sepa/pending-batches" && method === "GET") {
      return handleGetPendingBatches(event);
    }
    if (path === "/admin/sepa/reports/upload" && method === "POST") {
      return handleSepaReportUpload(event);
    }

    const match = matchTemplate(method, path);
    if (match) {
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
