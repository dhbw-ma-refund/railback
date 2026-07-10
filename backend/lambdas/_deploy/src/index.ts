// RailBack single-function dispatcher for the Lambda Function URL deployment.
//
// Deploy environment: ONE Lambda (student function, e.g. s241539) exposed via a
// public Lambda Function URL (AuthType NONE, CORS *). The Function URL delivers
// the API-Gateway HTTP-API v2.0 payload — event.requestContext.http.{method,path},
// rawPath, headers, body, isBase64Encoded — which is exactly the ApiGwEvent shape
// the three HTTP handlers already parse. No API Gateway, no separate functions,
// no S3/SNS/EventBridge triggers are available in this environment.
//
// This module fans one incoming request out to the three self-contained HTTP
// handlers by path prefix, and exposes a small set of shared-secret-gated
// internal routes for the async work that would normally be trigger-driven.
//
// The bootstrap side-effect import MUST be first: it registers the "ddb" storage
// backend so db() resolves under RAILBACK_STORAGE=ddb at cold start. Importing it
// here (and transitively via each sub-handler) is idempotent — registerBackend is
// a keyed Map.set (lib/src/storage/registry.ts).
import "@railback/lib/storage/bootstrap";

import { AppError } from "@railback/lib/errors";
import { jsonResponse, errorResponse } from "@railback/lib/http/response";

// The three HTTP handlers. These packages have no index.ts / exports map
// (main = src/handler.ts), so import the handler module by explicit path. The
// ".js" specifier resolves to the .ts source under moduleResolution:bundler and
// is rewritten by esbuild at bundle time.
import { handler as authHandler } from "@railback/lambdas-auth-handler/src/handler.js";
import { handler as userHandler } from "@railback/lambdas-user-handler/src/handler.js";
import { handler as adminHandler } from "@railback/lambdas-admin-handler/src/handler.js";

// Event-driven handlers, re-exported cleanly from their index.ts.
import { handler as emailSweeper } from "@railback/email-sweeper";
import { handler as emailWebhook } from "@railback/email-webhook";
import { handler as anonSweeper } from "@railback/anonymisation-sweeper";
import { handler as sepaReports } from "@railback/sepa-reports";

// ApiGwEvent/ApiGwResponse are identical across all handlers; reuse the
// user-handler declaration to stay in one type universe.
import type { ApiGwEvent, ApiGwResponse } from "@railback/lambdas-user-handler/src/event.js";

// Fail fast + loud if storage isn't wired to real DynamoDB. Without this a
// missing RAILBACK_STORAGE silently selects the in-memory mock — the function
// would boot fine and then serve/persist nothing. Cold-start throw is preferable
// to a silently-empty production. RAILBACK_STORAGE=memory is still allowed for
// local/dev runs of this module.
const storage = process.env["RAILBACK_STORAGE"];
if (storage !== "ddb" && storage !== "memory") {
  throw new Error(
    `RAILBACK_STORAGE must be "ddb" (or "memory" for local dev); got "${storage ?? "(unset)"}"`,
  );
}

// Shared-secret gate for /_internal/*. These routes sit on a PUBLIC URL with no
// bearer auth — the only guard is this header. If RAILBACK_INTERNAL_SECRET is
// unset the routes are DISABLED (fail closed). Never log the secret; rotate it
// after the demo. Not suitable for production without real auth.
function internalAuthorized(event: ApiGwEvent): boolean {
  const expected = process.env["RAILBACK_INTERNAL_SECRET"];
  if (!expected) return false;
  const got = event.headers?.["x-internal-secret"] ?? event.headers?.["X-Internal-Secret"];
  return typeof got === "string" && got === expected;
}

// Internal routes require an exact event-payload shape (SnsEvent / S3Event). A
// malformed body yields {} here and the downstream handler throws → 500. The
// implicit contract: caller provides the correct shape or gets a 500.
function parseBody(event: ApiGwEvent): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function handler(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase() ?? "GET";
    const path = event.requestContext?.http?.path ?? event.rawPath ?? "";

    // CORS preflight. The Function URL's native CORS also answers this; we
    // respond here too so behaviour is identical whether or not native CORS is
    // configured, and to advertise the x-internal-secret header.
    if (method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization,content-type,x-internal-secret",
          "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
        },
        body: "",
      };
    }

    // Liveness probe (no auth) — handy for the demo / uptime check.
    if (path === "/" || path === "/health") {
      return jsonResponse(200, { ok: true, service: "railback", ts: new Date().toISOString() });
    }

    // --- Public HTTP surface: dispatch by prefix. Pass event through VERBATIM;
    // the sub-handlers self-route on the path and re-derive their own path
    // params (Function URLs do not populate event.pathParameters). ---
    if (path.startsWith("/auth")) return authHandler(event);
    if (path.startsWith("/users")) return userHandler(event);
    if (path.startsWith("/admin")) return adminHandler(event);

    // --- Internal ops surface (shared-secret): replaces cron/SNS/S3 triggers. ---
    if (path.startsWith("/_internal")) {
      if (method !== "POST") {
        return errorResponse(new AppError("ERR_NOT_FOUND", `route ${method} ${path} not found`));
      }
      if (!internalAuthorized(event)) {
        return errorResponse(
          new AppError("ERR_FORBIDDEN", "internal route requires a valid x-internal-secret header"),
        );
      }

      // email retry (Pass A) + 24h watchdog (Pass B). Body ignored.
      if (path === "/_internal/email-sweep") {
        return jsonResponse(200, await emailSweeper(undefined));
      }

      // Replay an SES delivery/bounce/complaint SNS notification. Body must be
      // { Records: [{ Sns: { Message: "<stringified SES-event JSON>" } }] }.
      if (path === "/_internal/email-webhook") {
        return jsonResponse(200, await emailWebhook(parseBody(event) as never));
      }

      // GDPR cascade (Pass A) + mandate expiry (Pass B). Body ignored.
      if (path === "/_internal/anonymisation-sweep") {
        return jsonResponse(200, await anonSweeper(undefined));
      }

      // Process an admin-uploaded pain.002 / camt.05x report already in S3.
      // Body must be { Records: [{ s3: { bucket: { name }, object: { key } } }] }.
      if (path === "/_internal/sepa-reports") {
        return jsonResponse(200, await sepaReports(parseBody(event) as never));
      }

      return errorResponse(new AppError("ERR_NOT_FOUND", `internal route ${path} not found`));
    }

    return errorResponse(new AppError("ERR_NOT_FOUND", `route ${method} ${path} not found`));
  } catch (err) {
    return errorResponse(err);
  }
}
