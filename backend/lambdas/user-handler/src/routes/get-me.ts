// GET /users/me
// - Bearer auth (USER only).
// - Returns the general profile view (no IBAN/BIC — those live at
//   /users/me/refund-data).
// - If the row has somehow vanished while the token is still valid
//   (e.g. anonymisation-sweeper fired during the access-token TTL
//   window), surface ERR_AUTH_EXPIRED so the frontend drops the
//   tokens and forces re-login — same UX as a revoked account.

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { profileView } from "../projections.js";

export async function handleGetMe(event: ApiGwEvent): Promise<ReturnType<typeof okJson>> {
  try {
    const { email } = requireUserCaller(event);
    const u = await db().users.getByEmail(email);
    if (!u) {
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }
    return okJson(200, profileView(u));
  } catch (err) {
    return errorResponse(err);
  }
}
