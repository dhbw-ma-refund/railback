/**
 * Format a decimal-string money value as EUR. The backend contract keeps
 * money as strings to avoid float rounding; we pass through unchanged if
 * parsing fails so the raw value stays visible instead of silently zeroing.
 */
const EUR = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtEUR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return EUR.format(n);
}
