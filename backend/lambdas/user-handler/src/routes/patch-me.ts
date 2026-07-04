// PATCH /users/me
// - Bearer auth (USER only).
// - Partial profile update. zod schema enforces "at least one field"
//   and shape of `adresse` (all five subfields together if sent).
// - Forbidden fields (iban/bic/user_state/email) aren't on the
//   patchUserRequestSchema, so they're silently dropped by safeParse.
//   That matches the contract: bank goes through PATCH /users/me/bank;
//   user_state is admin-only; email is immutable in v1.
// - Returns the full GET /users/me shape after the update.
// - If the row has somehow vanished while the token is still valid
//   (e.g. anonymisation-sweeper fired during the access-token TTL
//   window), surface ERR_AUTH_EXPIRED so the frontend drops the
//   tokens and forces re-login — same UX as GET / DELETE /users/me
//   and same fix as the 2026-07-01 audit finding `patch-me-vanished-row-404`.
//   Without this check the repo would raise ERR_NOT_FOUND with the
//   caller's email in the message (info-leak-adjacent) and a 404
//   status that doesn't tell the frontend to re-auth.
//
// Address is whole-object replacement when sent — the zod schema
// rejects partial address (all five fields required). The userforms
// contract calls that out explicitly.

import { patchUserRequestSchema } from "@railback/lib/schemas/user";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import type { ProfilePatch } from "@railback/lib/types/dto";
import type { ApiGwEvent } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";
import { profileView } from "../projections.js";

export async function handlePatchMe(event: ApiGwEvent): Promise<ReturnType<typeof okJson>> {
  try {
    const { email } = requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = patchUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "patch body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // Symmetric with GET / DELETE /users/me — a vanished row surfaces as
    // 401 ERR_AUTH_EXPIRED so the frontend re-auths, not 404 with the
    // caller's email in the message.
    const existing = await db().users.getByEmail(email);
    if (!existing) {
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }

    // Project the wire-shape patch onto the repo's ProfilePatch shape.
    // The schema's TypeScript inference already drops fields we don't
    // accept (iban/bic/email/user_state) — but we still copy explicitly
    // instead of spreading, so a future schema-loosening can't widen the
    // patch by accident.
    const patch: ProfilePatch = {};
    if (parsed.data.vorname !== undefined) patch.vorname = parsed.data.vorname;
    if (parsed.data.nachname !== undefined) patch.nachname = parsed.data.nachname;
    if (parsed.data.telefon !== undefined) patch.telefon = parsed.data.telefon;
    if (parsed.data.adresse !== undefined) patch.adresse = parsed.data.adresse;

    const updated = await db().users.updateProfile(email, patch);
    return okJson(200, profileView(updated));
  } catch (err) {
    return errorResponse(err);
  }
}
