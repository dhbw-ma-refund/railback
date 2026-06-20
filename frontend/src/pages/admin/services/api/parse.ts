/**
 * Boundary narrowers for network payloads. Guard first, then read — never
 * inline-cast to a fabricated shape.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function readString(source: Record<string, unknown>, key: string): string | null {
  const v = source[key];
  return typeof v === 'string' ? v : null;
}

export function readNumber(source: Record<string, unknown>, key: string): number {
  const v = source[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function readArray(source: Record<string, unknown>, key: string): unknown[] {
  const v = source[key];
  return Array.isArray(v) ? v : [];
}

export function readRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const v = source[key];
  return isRecord(v) ? v : null;
}
