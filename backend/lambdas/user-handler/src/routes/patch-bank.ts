// PATCH /users/me/bank
// - Bearer auth (USER only).
// - Body: { iban, bic } — both Pflicht (BIC alone is meaningless, so we
//   don't allow partial updates). zod normalises both (whitespace
//   stripped, uppercased) and validates IBAN mod-97 + BIC regex.
// - Encrypts via @railback/lib/crypto/iban before persisting; the
//   plaintext never touches DDB.
// - Returns the just-stored iban/bic (echoed from the patch input —
//   re-decrypting would just round-trip the same value). Frontend
//   uses this echo as a success confirmation; no other side-effects.
// - If the user row has vanished mid-token (anonymisation-sweeper etc.),
//   surface ERR_AUTH_EXPIRED like GET / DELETE / PATCH /users/me
//   instead of the repo's default ERR_NOT_FOUND (which leaks the email
//   in the message and yields a 404 the frontend can't map to re-auth).
//   Locked 2026-07-01 per audit finding `patch-me-vanished-row-404`.

import { patchBankRequestSchema } from "@railback/lib/schemas/user";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import type { ApiGwEvent } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";
import { requireUserCaller } from "../auth-context.js";

export async function handlePatchBank(
  event: ApiGwEvent,
): Promise<ReturnType<typeof okJson>> {
  try {
    const { email } = requireUserCaller(event);
    const body = readJsonBody(event);
    const parsed = patchBankRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "bank update body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }

    // Vanished-row check symmetric with GET / DELETE / PATCH /users/me.
    const existing = await db().users.getByEmail(email);
    if (!existing) {
      throw new AppError("ERR_AUTH_EXPIRED", "user account no longer exists");
    }

    // Encrypt-first so a missing KEK fails BEFORE we touch the row.
    const iban_enc = encryptIban(parsed.data.iban);
    const bic_enc = encryptBic(parsed.data.bic);

    await db().users.updateProfile(email, { iban_enc, bic_enc });

    // Echo back the normalised values (zod already did .replace(/\s+/g, "").toUpperCase()).
    return okJson(200, { iban: parsed.data.iban, bic: parsed.data.bic });
  } catch (err) {
    return errorResponse(err);
  }
}
