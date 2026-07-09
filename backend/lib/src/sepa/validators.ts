// SEPA validators — IBAN (regex + mod-97), BIC, Gläubiger-ID.
// Mod-97: move first 4 chars to end, A=10..Z=35, BigInt % 97n === 1n.

import { AppError } from "../errors/index.js";

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function normaliseIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

export function normaliseBic(bic: string): string {
  return bic.replace(/\s+/g, "").toUpperCase();
}

function lettersToDigits(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) {
      out += ch;
    } else if (code >= 65 && code <= 90) {
      out += (code - 55).toString();
    } else {
      return "";
    }
  }
  return out;
}

function mod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = lettersToDigits(rearranged);
  if (!digits) return false;
  try {
    return BigInt(digits) % 97n === 1n;
  } catch {
    return false;
  }
}

export function validateIban(iban: string): ValidationResult {
  const n = normaliseIban(iban);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(n)) {
    return { valid: false, reason: "format" };
  }
  if (!mod97(n)) {
    return { valid: false, reason: "checksum" };
  }
  return { valid: true };
}

export function validateBic(bic: string): ValidationResult {
  const n = normaliseBic(bic);
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(n)) {
    return { valid: false, reason: "format" };
  }
  return { valid: true };
}

export function validateGlaeubigerId(id: string): ValidationResult {
  const n = id.replace(/\s+/g, "").toUpperCase();
  if (!/^DE[0-9]{2}[A-Z0-9]{3}[0-9]{11}$/.test(n)) {
    return { valid: false, reason: "format" };
  }
  return { valid: true };
}

export function assertValidIban(iban: string, field = "iban"): void {
  const r = validateIban(iban);
  if (!r.valid) {
    throw new AppError("ERR_VALIDATION", `Invalid IBAN (${r.reason})`, undefined, { field });
  }
}

export function assertValidBic(bic: string, field = "bic"): void {
  const r = validateBic(bic);
  if (!r.valid) {
    throw new AppError("ERR_VALIDATION", `Invalid BIC (${r.reason})`, undefined, { field });
  }
}

export function assertValidGlaeubigerId(id: string, field = "glaeubiger_id"): void {
  const r = validateGlaeubigerId(id);
  if (!r.valid) {
    throw new AppError(
      "ERR_VALIDATION",
      `Invalid Gläubiger-ID (${r.reason})`,
      undefined,
      { field }
    );
  }
}
