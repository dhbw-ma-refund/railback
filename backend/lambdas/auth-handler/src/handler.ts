// Storage bootstrap (side-effect): registers the "ddb" backend so db()
// resolves under RAILBACK_STORAGE=ddb at cold start. Must precede any db()
// call. Memory-mode is registered by the vitest setup files instead.
import "@railback/lib/storage/bootstrap";

// auth-handler entry point. Routes /auth/register, /auth/login, /auth/refresh
// based on the HTTP method + path the API GW v2 event carries.
//
// API Gateway HTTP API routes each method+path independently to this
// handler — we don't have to do path matching in production. But because
// integration tests boot the handler in-process and dispatch by hand, we
// keep a small router here.
//
// ⚠ DEPLOY-GAP (Phase 2.1, will land in Phase 5):
//   This handler calls `db()` from @railback/lib/storage, which dispatches
//   on the RAILBACK_STORAGE env var to a previously-registered factory.
//   The lambda zip does NOT currently import a storage bootstrap — at
//   cold-start, the storage registry is empty and `db()` throws
//   ERR_INTERNAL ("no factory registered for memory|ddb").
//
//   Tests work because vitest setup files import @railback/mocks-in-memory
//   for its side-effect register call. Real lambda invocations need a
//   bootstrap.ts (Phase 5) that does the same — and for prod, that
//   bootstrap imports the real @railback/lib/storage/ddb adapters once
//   those exist.
//
//   See BUILD.md "Phase 2.1 status" for the full picture.

import { AppError } from "@railback/lib/errors";
import type { ApiGwEvent, ApiGwResponse } from "./event.js";
import { errorResponse } from "./response.js";
import { handleLogin } from "./routes/post-login.js";
import { handleRefresh } from "./routes/post-refresh.js";
import { handleRegister } from "./routes/post-register.js";

export async function handler(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const method = event.requestContext?.http?.method?.toUpperCase();
    const path = event.requestContext?.http?.path ?? event.rawPath ?? "";

    if (method !== "POST") {
      return errorResponse(
        new AppError("ERR_NOT_FOUND", `route ${method ?? "?"} ${path} not found`),
      );
    }

    if (path === "/auth/register") return handleRegister(event);
    if (path === "/auth/login") return handleLogin(event);
    if (path === "/auth/refresh") return handleRefresh(event);

    return errorResponse(
      new AppError("ERR_NOT_FOUND", `route ${method} ${path} not found`),
    );
  } catch (err) {
    return errorResponse(err);
  }
}
