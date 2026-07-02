// POST /auth/refresh
// - Verifies the refresh token; on signature / expiry failure → ERR_AUTH_EXPIRED.
// - Re-reads the underlying account (admin first, then user) and rejects
//   SUSPENDED / DELETION_SCHEDULED with ERR_FORBIDDEN. This is the only
//   revocation path that takes effect within one access-token TTL of an
//   admin ban — refresh tokens themselves are stateless, no
//   server-side blacklist (locked in DECISIONS.md MVP trade-off).
// - On success: rotates BOTH tokens (new access + new refresh). Old
//   refresh tokens remain valid until their own expiry — documented
//   limitation.

import { refreshRequestSchema } from "@railback/lib/schemas/auth";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "@railback/lib/auth/jwt";
import type { ApiGwEvent } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";

export async function handleRefresh(event: ApiGwEvent): Promise<ReturnType<typeof okJson>> {
  try {
    const body = readJsonBody(event);
    const parsed = refreshRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("ERR_AUTH_INVALID", "invalid refresh request");
    }
    const claims = verifyRefreshToken(parsed.data.refreshToken);
    const email = claims.sub;
    const role = claims.role;
    const expiresIn = Number(process.env.RAILBACK_JWT_ACCESS_TTL_SEC ?? "900");

    // Re-read the underlying row matching the token's claimed role.
    // Admin tokens don't get the user-state gate (admin accounts can't
    // be banned via this flow); they just need the row to still exist.
    if (role === "ADMIN") {
      const a = await db().admins.getByEmailForAuth(email);
      if (!a) {
        // The admin row was deleted out-of-band → treat the token as
        // expired so the frontend forces a re-login.
        throw new AppError("ERR_AUTH_EXPIRED", "admin account no longer exists");
      }
      return okJson(200, {
        accessToken: signAccessToken({ email: a.email, role: "ADMIN" }),
        refreshToken: signRefreshToken({ email: a.email, role: "ADMIN" }),
        expiresIn,
        user: {
          email: a.email,
          vorname: "",
          nachname: "",
          role: "ADMIN" as const,
        },
      });
    }

    // USER role
    const u = await db().users.getByEmailForAuth(email);
    if (!u) {
      // User row was deleted (e.g. anonymisation-sweeper cleared it) →
      // refresh fails. Frontend should drop the tokens and force re-login.
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }
    if (u.user_state === "SUSPENDED") {
      throw new AppError("ERR_FORBIDDEN", "account suspended", undefined, {
        user_state: "SUSPENDED",
        ...(u.suspended_reason !== undefined ? { suspended_reason: u.suspended_reason } : {}),
      });
    }
    if (u.user_state === "DELETION_SCHEDULED") {
      throw new AppError("ERR_FORBIDDEN", "account scheduled for deletion", undefined, {
        user_state: "DELETION_SCHEDULED",
      });
    }

    return okJson(200, {
      accessToken: signAccessToken({ email: u.email, role: "USER" }),
      refreshToken: signRefreshToken({ email: u.email, role: "USER" }),
      expiresIn,
      user: {
        email: u.email,
        vorname: u.vorname,
        nachname: u.nachname,
        role: "USER" as const,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
