// AES-256-GCM encryption for IBAN / BIC at-rest values.
// Layout of the encoded blob: base64( iv (12 bytes) || authTag (16 bytes) || ciphertext ).
// IBANs are normalised (whitespace stripped, uppercased) before encrypt so
// the round-trip output is canonical regardless of how the user typed it.

import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getKek } from "./kek.js";

const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Thrown when ciphertext can't be decrypted (corrupted blob, wrong KEK
 * material, GCM auth-tag mismatch, etc.). Distinct from AppError so call
 * sites can catch corrupted-row failures (where the right UX is "treat
 * as missing data") without swallowing real server-config failures
 * (which getKek() raises as AppError(ERR_INTERNAL, …) and which MUST
 * still surface as 500s).
 */
export class DecryptionFailedError extends Error {
  constructor(message = "decryption failed") {
    super(message);
    this.name = "DecryptionFailedError";
  }
}

export function encryptValue(plain: string): string {
  const kek = getKek();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptValue(encoded: string): string {
  // getKek() runs OUTSIDE the try: a missing/malformed KEK is a server
  // misconfiguration, not a data-shape issue, and must propagate as
  // AppError(ERR_INTERNAL). Routes wrap iban/bic decrypt in safeDecrypt
  // (see lambdas/user-handler/src/projections.ts) which catches
  // DecryptionFailedError only — so a KEK error still 500s, while a
  // corrupted stored blob degrades to null in the response.
  const kek = getKek();
  try {
    const blob = Buffer.from(encoded, "base64");
    if (blob.length < IV_LEN + TAG_LEN) {
      throw new DecryptionFailedError("blob too short");
    }
    const iv = blob.subarray(0, IV_LEN);
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ciphertext = blob.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv("aes-256-gcm", kek, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch (err) {
    if (err instanceof DecryptionFailedError) throw err;
    // Catch everything else (createDecipheriv / GCM-auth-tag failure /
    // base64 decode) and re-tag as DecryptionFailedError so the call
    // surface stays one type. The original error.message is suppressed
    // — it can carry low-level details (key size, tag length) that we
    // don't want in the API response.
    throw new DecryptionFailedError();
  }
}

function normaliseIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

export function encryptIban(iban: string): string {
  return encryptValue(normaliseIban(iban));
}

export function decryptIban(enc: string): string {
  return decryptValue(enc);
}

export function encryptBic(bic: string): string {
  return encryptValue(bic.replace(/\s+/g, "").toUpperCase());
}

export function decryptBic(enc: string): string {
  return decryptValue(enc);
}
