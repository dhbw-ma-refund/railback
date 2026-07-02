// GET /users/me/refund-data
// - Bearer auth (USER only).
// - Returns the EU-form field set including DECRYPTED iban/bic.
// - Deliberately a separate endpoint from GET /users/me so admin-side
//   UI / dashboards can't accidentally surface bank data (the API
//   gateway can scope the admin role away from this path entirely if
//   needed; meanwhile, the role check inside requireUserCaller is
//   the runtime defence).
// - If the user row is gone → ERR_AUTH_EXPIRED (same as GET /users/me).

import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ApiGwEvent } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { refundDataView } from "../projections.js";

export async function handleGetRefundData(
  event: ApiGwEvent,
): Promise<ReturnType<typeof okJson>> {
  try {
    const { email } = requireUserCaller(event);
    const u = await db().users.getByEmail(email);
    if (!u) {
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }
    return okJson(200, refundDataView(u));
  } catch (err) {
    return errorResponse(err);
  }
}
