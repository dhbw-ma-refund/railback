// Projections from the User DTO to the API response shapes.
//
// Two distinct views:
//   - profileView: what /users/me (GET + PATCH) returns. NO IBAN/BIC,
//     no encrypted attributes, no suspended_* (those are admin-only).
//   - refundDataView: what /users/me/refund-data returns — the
//     EU-form field set, IBAN/BIC decrypted via @railback/lib/crypto/iban.
//
// Keeping both projections here (not inline in the route files) makes
// the "iban must never leak from GET /users/me" guarantee one-import
// reviewable.

import { DecryptionFailedError, decryptBic, decryptIban } from "@railback/lib/crypto/iban";
import type { User } from "@railback/lib/types/dto";
import type { GetUserResponse, RefundDataResponse } from "@railback/lib/schemas/user";

export function profileView(u: User): GetUserResponse {
  return {
    email: u.email,
    vorname: u.vorname,
    nachname: u.nachname,
    telefon: u.telefon,
    adresse: u.adresse,
    user_state: u.user_state,
    created_at: u.created_at,
  };
}

export function refundDataView(u: User): RefundDataResponse {
  // Both encrypted fields are written together at register-time (locked
  // 2026-06-21: iban+bic pflicht). The nullable response shape covers
  // a future edge case where a user row predates that decision; we
  // return null rather than throwing so the frontend can prompt for
  // a PATCH /users/me/bank.
  //
  // We also degrade to `null` on a CIPHERTEXT-level decrypt failure
  // (corrupted blob, GCM auth-tag mismatch) for the same reason: the
  // frontend's remedy is identical — re-collect via /users/me/bank.
  // We DO NOT swallow server-config failures (KEK missing/wrong-length)
  // — those bubble up as AppError(ERR_INTERNAL) and surface as a 500,
  // because making a broken deploy look like "user has no bank data"
  // would hide outages and send users down the wrong recovery path.
  // The split lives in @railback/lib/crypto/iban: KEK errors come out
  // as AppError, cipher errors as DecryptionFailedError.
  const iban = safeDecrypt(u.iban_enc, decryptIban);
  const bic = safeDecrypt(u.bic_enc, decryptBic);
  return {
    vorname: u.vorname,
    nachname: u.nachname,
    email: u.email,
    telefon: u.telefon,
    adresse: u.adresse,
    iban,
    bic,
  };
}

function safeDecrypt(
  enc: string | undefined,
  fn: (enc: string) => string,
): string | null {
  if (enc === undefined) return null;
  try {
    return fn(enc);
  } catch (err) {
    if (err instanceof DecryptionFailedError) {
      // Corrupted/incompatible ciphertext — treat as "no bank data".
      return null;
    }
    // KEK-missing, KEK-wrong-length, or any other AppError: let it
    // propagate so the route's outer try/catch returns 500.
    throw err;
  }
}
