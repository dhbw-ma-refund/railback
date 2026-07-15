/**
 * Ticket price input helpers.
 *
 * The backend accepts prices only in the strict form `^-?[0-9]+\.[0-9]{2}$`
 * (dot separator, exactly two decimals — see backend/lib/src/schemas/common.ts
 * decimalEurSchema). But users type prices in a variety of ways:
 *   40, 40,00, 40.00, 40,5, 1.234,56 (rare, but not weird)
 *
 * These helpers accept any of those, produce the canonical `XX.XX` string
 * for wizard state, and gate the Weiter button on whether the input is
 * *parseable* rather than whether it already matches the strict regex.
 */

/**
 * Return the canonical `XX.XX` string, or null if the input can't be
 * parsed as a price. Accepts:
 *   - "40"       → "40.00"
 *   - "40,00"    → "40.00"
 *   - "40.00"    → "40.00"
 *   - "40,5"     → "40.50"
 *   - "  40 ,50" → "40.50"     (whitespace tolerated)
 *   - "-1,50"    → "-1.50"     (negative allowed at the primitive level;
 *                               backend refuses negative prices at the
 *                               refund-schema layer, so this survives as
 *                               a caught error at submit if it slips in)
 * Rejects:
 *   - ""              → null
 *   - "abc"           → null
 *   - "40,"           → null   (trailing separator, ambiguous)
 *   - "40.5,00"       → null   (mixed separators)
 *   - "40,555"        → null   (more than 2 decimals)
 *
 * Thousands separators are NOT supported — DB tickets never cost that
 * much, and accepting them would make it ambiguous whether "1.234" is
 * "1234" or "1.23 rounded". Keep it strict.
 */
export function normalizePrice(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Reject mixed separators — "40.5,00" or "1,234.56". Users typing DE
  // and EN styles simultaneously is a bug on their end, not a locale
  // mismatch we should paper over.
  const hasDot = trimmed.includes('.');
  const hasComma = trimmed.includes(',');
  if (hasDot && hasComma) return null;

  // Unify to dot separator for parseFloat / regex.
  const unified = trimmed.replace(',', '.');

  // Must match: optional sign, digits, optional (dot + 0/1/2 digits).
  if (!/^-?\d+(\.\d{1,2})?$/.test(unified)) return null;

  // Round to two decimals via a fixed-point conversion — avoid parseFloat
  // to keep the exact digits the user typed (parseFloat("40.10") gives
  // "40.1" after toFixed(2), but for "40.1" input we want "40.10", and
  // both should land at the same string).
  const [intPart, decPart = ''] = unified.split('.');
  const paddedDec = (decPart + '00').slice(0, 2);
  return `${intPart}.${paddedDec}`;
}

/** True when normalize would return a non-null value. */
export function isPriceParseable(raw: string): boolean {
  return normalizePrice(raw) !== null;
}
