// POST /auth/register
// - Validates body against registerRequestSchema (incl. iban/bic Pflicht per
//   locked 2026-06-21 decision).
// - Hashes the password with scrypt.
// - Encrypts iban/bic with AES-256-GCM using RAILBACK_IBAN_KEK.
// - Writes the UserProfile row with user_state=ACTIVE.
// - Signs an access + refresh token pair, returns them with the user
//   summary. Role is hardcoded "USER" — admin rows are created
//   out-of-band, never via this endpoint.

import { registerRequestSchema } from "@railback/lib/schemas/auth";
import { AppError } from "@railback/lib/errors";
import { db } from "@railback/lib/storage";
import { hashPassword } from "@railback/lib/auth/password";
import { signAccessToken, signRefreshToken } from "@railback/lib/auth/jwt";
import { encryptBic, encryptIban } from "@railback/lib/crypto/iban";
import type { ApiGwEvent } from "../event.js";
import { readJsonBody } from "../event.js";
import { errorResponse, okJson } from "../response.js";

export async function handleRegister(event: ApiGwEvent): Promise<ReturnType<typeof okJson>> {
  try {
    const body = readJsonBody(event);
    const parsed = registerRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "ERR_VALIDATION",
        "register body is invalid",
        undefined,
        { issues: parsed.error.issues },
      );
    }
    const input = parsed.data;

    // Encrypt iban/bic up-front; if KEK is missing we want to fail BEFORE
    // we create the user row.
    const iban_enc = encryptIban(input.iban);
    const bic_enc = encryptBic(input.bic);
    const hashed_password = await hashPassword(input.password);

    const u = await db().users.create({
      email: input.email,
      vorname: input.vorname,
      nachname: input.nachname,
      telefon: input.telefon,
      adresse: input.adresse,
      hashed_password,
      iban_enc,
      bic_enc,
      datenschutz_einwilligung: input.datenschutz_einwilligung,
      agb_akzeptiert: input.agb_akzeptiert,
    });

    const accessToken = signAccessToken({ email: u.email, role: "USER" });
    const refreshToken = signRefreshToken({ email: u.email, role: "USER" });
    const expiresIn = Number(process.env.RAILBACK_JWT_ACCESS_TTL_SEC ?? "900");

    return okJson(201, {
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
