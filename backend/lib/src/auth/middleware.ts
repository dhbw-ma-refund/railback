// Auth middleware helpers. The Lambdas don't share an HTTP framework, so
// the contract is intentionally tiny: pull the bearer token off raw headers,
// verify it, hand back { email, role }. requireRole is a separate gate so
// admin-handler can still load USER tokens when it wants to.

import { AppError } from "../errors/index.js";
import type { Role } from "../types/enums.js";
import { verifyAccessToken } from "./jwt.js";

export function extractAuthFromHeaders(
  headers: Record<string, string | undefined>
): { email: string; role: Role } {
  const raw = headers["authorization"] ?? headers["Authorization"];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new AppError("ERR_AUTH_INVALID", "missing Authorization header");
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  if (!match || !match[1]) {
    throw new AppError("ERR_AUTH_INVALID", "expected Bearer token");
  }
  const claims = verifyAccessToken(match[1]);
  return { email: claims.sub, role: claims.role };
}

export function requireRole(claims: { role: Role }, required: Role): void {
  if (claims.role !== required) {
    throw new AppError("ERR_FORBIDDEN", `requires role ${required}`);
  }
}
