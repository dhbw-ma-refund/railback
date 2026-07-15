/**
 * Client-generated ULID (Universally Unique Lexicographically Sortable
 * Identifier) — required by the backend for every new ticket id and
 * beleg id where the frontend allocates the id.
 *
 * Format: 26 characters in Crockford's Base32 alphabet
 * (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`, i.e. no I / L / O / U). First 10
 * characters encode a 48-bit millisecond timestamp, remaining 16
 * characters are 80 bits of randomness from crypto.getRandomValues.
 *
 * Regex the backend validates against:
 *   /^[0-9A-HJKMNP-TV-Z]{26}$/
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTimestamp(now: number): string {
  const out = new Array<string>(10);
  let t = now;
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCKFORD[t % 32];
    t = Math.floor(t / 32);
  }
  return out.join('');
}

function encodeRandom(): string {
  // 16 chars × 5 bits = 80 bits. Sample 10 bytes and unpack.
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);

  // Convert 10 bytes → 80 bits → 16 base32 chars.
  let bits = 0;
  let buf = 0;
  const out: string[] = [];
  for (const byte of bytes) {
    buf = (buf << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push(CROCKFORD[(buf >>> bits) & 0x1f]);
    }
  }
  return out.join('');
}

export function ulid(now: number = Date.now()): string {
  return encodeTimestamp(now) + encodeRandom();
}

/** Regex mirrors backend/lib/src/schemas/common.ts ulidSchema. */
export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}
