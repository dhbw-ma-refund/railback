// DELETE /users/me
// - Bearer auth (USER only).
// - Body: { confirmPassword }. We re-verify the password via scrypt
//   before scheduling deletion. Stolen-access-token defence: an
//   attacker who got a token but not the password can't one-click
//   erase the account.
// - Suspended users CANNOT self-delete (locked: a ban must hold; the
//   user can't dodge the audit trail by switching to
//   DELETION_SCHEDULED — admin has to escalate manually). In practice
//   /auth/login already rejects SUSPENDED, so an attacker who got a
//   pre-ban token has at most one access-token TTL (~15 min) to try
//   this; we still defence-in-depth-check the row state here.
// - DELETION_SCHEDULED is idempotent: a second DELETE on an already-
//   scheduled account is a no-op success (204). Avoids confusing the
//   frontend if the user double-taps the dialog.
// - Password-first verify, state-check second — same order rationale
//   as auth-handler/post-login.ts (don't leak suspension state to a
//   wrong-password caller).

import { deleteUserRequestSchema } from "@railback/lib/schemas/user";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { verifyPassword } from "@railback/lib/auth/password";
import type { ApiGwEvent, ApiGwResponse } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, noContent } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

export async function handleDeleteMe(event: ApiGwEvent): Promise<ApiGwResponse> {
  try {
    const { email } = requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = deleteUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "delete body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    const auth = await db().users.getByEmailForAuth(email);
    if (!auth) {
      // The row vanished while the token was still valid; treat as a
      // stale token rather than a successful delete.
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }

    // Password-first (no state leak on wrong-password).
    const ok = await verifyPassword(parsed.data.confirmPassword, auth.hashed_password);
    if (!ok) {
      throw new AppError("ERR_AUTH_INVALID", "invalid confirmPassword");
    }

    if (auth.user_state === "SUSPENDED") {
      throw new AppError("ERR_FORBIDDEN", "suspended accounts cannot self-delete", undefined, {
        user_state: "SUSPENDED",
        ...(auth.suspended_reason !== undefined
          ? { suspended_reason: auth.suspended_reason }
          : {}),
      });
    }
    if (auth.user_state === "DELETION_SCHEDULED") {
      // Idempotent — already in the target state.
      return noContent();
    }

    await db().users.scheduleDeletion(email);
    return noContent();
  } catch (err) {
    return errorResponse(err);
  }
}
