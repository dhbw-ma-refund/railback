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

/**
 * Dev-mode warning when the backend drops a field our types depend on.
 * Silent in production so we do not spam paying admins over network hiccups;
 * loud in `import.meta.env.DEV` so contract drift shows up on `bun run dev`.
 *
 * Deduped per (context, field) so a 50-row list emits one warn per field,
 * not fifty.
 */
const warnedKeys: Record<string, true> = {};

export function warnMissingField(
  context: string,
  field: string,
  raw: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) return;
  if (field in raw) return;
  const key = `${context}:${field}`;
  if (warnedKeys[key]) return;
  warnedKeys[key] = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[api] contract drift: ${context} is missing required field "${field}". ` +
      `Backend payload keys: ${Object.keys(raw).join(', ')}`,
  );
}
