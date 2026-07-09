// String-decimal arithmetic — money is stored and exchanged as decimal strings
// ("10.50" / "-3.25" / "0.00"). All ops are exact via bigint; mulDecimal uses
// half-even (banker's) rounding when the product needs to be truncated to 2dp.

const RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export interface ParsedDecimal {
  sign: 1 | -1;
  whole: bigint;
  fraction: bigint;
  scale: number;
}

export function parseDecimal(s: string): ParsedDecimal {
  if (typeof s !== "string") {
    throw new Error(`parseDecimal: not a string: ${typeof s}`);
  }
  const trimmed = s.trim();
  const m = RE.exec(trimmed);
  if (!m) throw new Error(`parseDecimal: invalid decimal "${s}"`);
  const wholeStr = m[2] ?? "";
  if (wholeStr.length === 0) throw new Error(`parseDecimal: invalid decimal "${s}"`);
  const sign: 1 | -1 = m[1] === "-" ? -1 : 1;
  const whole = BigInt(wholeStr);
  const fracStr = m[3] ?? "";
  const fraction = fracStr.length === 0 ? 0n : BigInt(fracStr);
  return { sign, whole, fraction, scale: fracStr.length };
}

/** Convert parsed → signed bigint at given scale (target scale must be >= source). */
function toScaled(p: ParsedDecimal, scale: number): bigint {
  if (scale < p.scale) {
    throw new Error(`toScaled: target scale ${scale} < source scale ${p.scale}`);
  }
  const padFrac = 10n ** BigInt(scale - p.scale);
  const tenScale = 10n ** BigInt(scale);
  const magnitude = p.whole * tenScale + p.fraction * padFrac;
  return BigInt(p.sign) * magnitude;
}

/** Format signed bigint at scale into "-?\d+(\.\d{scale})?". */
function format(value: bigint, scale: number): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  if (scale === 0) {
    return (neg ? "-" : "") + abs.toString();
  }
  const ten = 10n ** BigInt(scale);
  const whole = abs / ten;
  const frac = abs % ten;
  const fracStr = frac.toString().padStart(scale, "0");
  const body = `${whole.toString()}.${fracStr}`;
  // canonicalise -0.00 → 0.00
  if (whole === 0n && frac === 0n) return `0.${"0".repeat(scale)}`;
  return (neg ? "-" : "") + body;
}

/** Half-even round a value at scale → scale=2. */
function roundToTwo(value: bigint, scale: number): string {
  if (scale === 2) return format(value, 2);
  if (scale < 2) {
    return format(value * 10n ** BigInt(2 - scale), 2);
  }
  const dropDigits = scale - 2;
  const ten = 10n ** BigInt(dropDigits);
  const halfTen = ten / 2n;
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const quotient = abs / ten;
  const remainder = abs % ten;
  let rounded = quotient;
  if (remainder > halfTen) {
    rounded = quotient + 1n;
  } else if (remainder === halfTen) {
    if (quotient % 2n !== 0n) rounded = quotient + 1n;
  }
  const signed = neg ? -rounded : rounded;
  return format(signed, 2);
}

function addOrSub(a: string, b: string, op: 1 | -1): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const result = toScaled(pa, scale) + BigInt(op) * toScaled(pb, scale);
  return roundToTwo(result, scale);
}

export function addDecimal(a: string, b: string): string {
  return addOrSub(a, b, 1);
}

export function subDecimal(a: string, b: string): string {
  return addOrSub(a, b, -1);
}

/**
 * Multiply a decimal string by a regular Number factor. Factor is converted
 * to its exact decimal representation via toString, so 0.25 stays 0.25 (no
 * binary-float drift introduced); pathological factors like 0.1 + 0.2 carry
 * the JS-float artefact in but that's the caller's lookout.
 */
export function mulDecimal(a: string, factor: number): string {
  if (!Number.isFinite(factor)) {
    throw new Error(`mulDecimal: non-finite factor ${factor}`);
  }
  const pa = parseDecimal(a);
  const pf = parseDecimal(factor.toString());
  const scale = pa.scale + pf.scale;
  const product =
    BigInt(pa.sign) *
    BigInt(pf.sign) *
    (pa.whole * 10n ** BigInt(pa.scale) + pa.fraction) *
    (pf.whole * 10n ** BigInt(pf.scale) + pf.fraction);
  return roundToTwo(product, scale);
}

export function sumDecimals(arr: string[]): string {
  let acc = "0.00";
  for (const v of arr) acc = addDecimal(acc, v);
  return acc;
}

export function cmpDecimal(a: string, b: string): -1 | 0 | 1 {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const av = toScaled(pa, scale);
  const bv = toScaled(pb, scale);
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function isZero(a: string): boolean {
  const p = parseDecimal(a);
  return p.whole === 0n && p.fraction === 0n;
}

/** "10.50" → "10,50 EUR". Always keeps 2dp (rounds if input has more). */
export function formatEur(s: string): string {
  const p = parseDecimal(s);
  const scale = Math.max(p.scale, 2);
  const normalised = roundToTwo(toScaled(p, scale), scale);
  return normalised.replace(".", ",") + " EUR";
}
