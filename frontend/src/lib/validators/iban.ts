/**
 * IBAN + BIC format validators — mirror backend/lib/src/schemas/common.ts.
 * We validate locally to keep the wizard responsive; the backend re-validates
 * on every write, so this is UX, not security.
 */

const IBAN_STRUCTURE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/;
const BIC_STRUCTURE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

/** Strip whitespace and uppercase — matches the backend transform. */
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

export function normalizeBic(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase();
}

/**
 * ISO/IEC 7064 mod-97-10 checksum. Move first four chars to end, replace
 * letters with their two-digit numeric value (A=10, …, Z=35), then check
 * the resulting integer mod 97 equals 1.
 */
function mod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value =
      ch >= '0' && ch <= '9'
        ? ch.charCodeAt(0) - 48
        : ch.charCodeAt(0) - 55; // 'A' → 10
    remainder = (remainder * (value >= 10 ? 100 : 10) + value) % 97;
  }
  return remainder;
}

export function validateIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!IBAN_STRUCTURE.test(iban)) return false;
  return mod97(iban) === 1;
}

export function validateBic(input: string): boolean {
  const bic = normalizeBic(input);
  return BIC_STRUCTURE.test(bic);
}
