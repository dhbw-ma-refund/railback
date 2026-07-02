// POST /auth/login
// - Same endpoint for users and admins. Backend dispatches by role.
// - Two-lookup dispatch (locked 2026-06-21): try admins.getByEmailForAuth
//   first, fall back to users.getByEmailForAuth. Admin wins if both
//   exist.
// - Deliberately does NOT distinguish "no such email" vs "wrong password"
//   in the error response — both surface as ERR_AUTH_INVALID.
// - Rejects SUSPENDED / DELETION_SCHEDULED user accounts with
//   ERR_FORBIDDEN; the response includes details.user_state and (for
//   suspended) details.suspended_reason. Admin accounts don't have a
//   user_state field — they can't be banned via this flow (admins are
//   managed out-of-band).

import { loginRequestSchema } from "@railback/lib/schemas/auth";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { verifyPassword } from "@railback/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@railback/lib/auth/jwt";
import type { ApiGwEvent } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";

export async function handleLogin(event: ApiGwEvent): Promise<ReturnType<typeof okJson>> {
  try {
    const body = readJsonBody(event);
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Don't leak structure — bad shape == bad creds for login.
      throw new AppError("ERR_AUTH_INVALID", "invalid credentials");
    }
    const { email, password } = parsed.data;
    const expiresIn = Number(process.env.RAILBACK_JWT_ACCESS_TTL_SEC ?? "900");

    // 1) Try admin lookup first.
    const adminHit = await db().admins.getByEmailForAuth(email);
    if (adminHit) {
      const ok = await verifyPassword(password, adminHit.hashed_password);
      if (!ok) throw new AppError("ERR_AUTH_INVALID", "invalid credentials");
      const accessToken = signAccessToken({ email: adminHit.email, role: "ADMIN" });
      const refreshToken = signRefreshToken({ email: adminHit.email, role: "ADMIN" });
      return okJson(200, {
        accessToken,
        refreshToken,
        expiresIn,
        user: {
          email: adminHit.email,
          // Admins have no vorname/nachname in the row — surface empty
          // strings so the response shape stays uniform for the frontend.
          vorname: "",
          nachname: "",
          role: "ADMIN" as const,
        },
      });
    }

    // 2) Fall back to user lookup.
    const u = await db().users.getByEmailForAuth(email);
    if (!u) {
      // Don't distinguish from wrong-password.
      throw new AppError("ERR_AUTH_INVALID", "invalid credentials");
    }

    // Password-FIRST verify, then state-check (locked 2026-06-21 security
    // fix). The previous order (state-check first) leaked the SUSPENDED
    // state + suspended_reason to anyone who typed the email. Cost: we
    // spend an extra scrypt cycle (~50ms) on banned-account login
    // attempts. Acceptable — login latency is in the same range anyway,
    // and an attacker who already knows a valid password gets the same
    // response either way; an attacker who doesn't know the password
    // can no longer enumerate "this email is suspended".
    const ok = await verifyPassword(password, u.hashed_password);
    if (!ok) throw new AppError("ERR_AUTH_INVALID", "invalid credentials");

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

    const accessToken = signAccessToken({ email: u.email, role: "USER" });
    const refreshToken = signRefreshToken({ email: u.email, role: "USER" });

    return okJson(200, {
      accessToken,
      refreshToken,
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
