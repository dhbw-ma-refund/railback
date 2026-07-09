// ULID generator — Crockford base32, 48-bit timestamp + 80-bit randomness.
// Inline so the lib has zero runtime deps.

import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ALPHABET.length;
const TIME_LEN = 10;
const RAND_LEN = 16; // base32 chars in the random tail
const RAND_BYTES = 10; // 10 bytes = 80 bits = 16 base32 chars
export const ULID_LEN = TIME_LEN + RAND_LEN; // 26

let lastTime = -1;
let lastRand: Uint8Array = new Uint8Array(RAND_BYTES);

function encodeTime(now: number): string {
  if (now < 0 || !Number.isFinite(now)) {
    throw new Error(`ulid: invalid timestamp ${now}`);
  }
  let t = Math.floor(now);
  let out = "";
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = t % ENCODING_LEN;
    out = (ALPHABET[mod] as string) + out;
    t = (t - mod) / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(rand: Uint8Array): string {
  // 10 bytes × 8 bits = 80 bits → 16 base32 chars exactly.
  let out = "";
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < rand.length; i++) {
    acc = (acc << 8) | (rand[i] as number);
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const idx = (acc >>> bits) & 0x1f;
      out += ALPHABET[idx] as string;
    }
  }
  return out;
}

function incrementRandom(buf: Uint8Array): Uint8Array {
  const next = new Uint8Array(buf);
  for (let i = next.length - 1; i >= 0; i--) {
    const cur = next[i] as number;
    if (cur === 0xff) {
      next[i] = 0;
      continue;
    }
    next[i] = cur + 1;
    return next;
  }
  // overflow — extremely unlikely; fall back to fresh randomness
  return Uint8Array.from(randomBytes(RAND_BYTES));
}

export function ulid(now?: number): string {
  const t = now ?? Date.now();
  let rand: Uint8Array;
  if (t === lastTime) {
    rand = incrementRandom(lastRand);
  } else {
    rand = Uint8Array.from(randomBytes(RAND_BYTES));
  }
  lastTime = t;
  lastRand = rand;
  return encodeTime(t) + encodeRandom(rand);
}
