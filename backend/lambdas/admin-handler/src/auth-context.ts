// Shared auth gate for /admin/* routes. Requires a Bearer token with
// role=ADMIN; USER tokens get ERR_FORBIDDEN (admins log in via the same
// /auth/login endpoint and get a role=ADMIN token).

import { AppError } from "@railback/lib/errors";
import { extractAuthFromHeaders } from "@railback/lib/auth/middleware";
import type { ApiGwEvent } from "./event.js";

export function requireAdminCaller(event: ApiGwEvent): { email: string } {
  const { email, role } = extractAuthFromHeaders(event.headers);
  if (role !== "ADMIN") {
    throw new AppError("ERR_FORBIDDEN", "requires role ADMIN");
  }
  return { email };
}
