// Shared auth gate for /users/me/* routes. Extracts the bearer token,
// verifies it, and enforces role === "USER". ADMIN tokens get
// ERR_FORBIDDEN — admins use /admin/* via admin-handler for everything
// including their own profile (no admin profile UI in v1 anyway).
//
// Returns the caller's email — already normalised by the JWT-sign step
// because tokens are issued by auth-handler off the normalised
// User.email value.

import { AppError } from "@railback/lib/errors";
import { extractAuthFromHeaders } from "@railback/lib/auth/middleware";
import type { ApiGwEvent } from "./event.js";

export function requireUserCaller(event: ApiGwEvent): { email: string } {
  const { email, role } = extractAuthFromHeaders(event.headers);
  if (role !== "USER") {
    throw new AppError("ERR_FORBIDDEN", "requires role USER");
  }
  return { email };
}
