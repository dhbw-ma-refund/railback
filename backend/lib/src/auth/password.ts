// scrypt-based password hashing. node:crypto only — no bcrypt dep so the
// Lambda zip stays small and there is no native build step. Hash format
// embeds N/r/p so we can rotate parameters later without breaking old rows.

import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number }
) => Promise<Buffer>;

const N = 16_384;
const R = 8;
const P = 1;
const SALT_LEN = 16;
const KEY_LEN = 64;
// scrypt's default maxmem (32 MiB) is too tight for N=16384,r=8 — bump it.
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("password must be a non-empty string");
  }
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(plain, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (typeof plain !== "string" || typeof hash !== "string") return false;
  const parts = hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number.parseInt(parts[1] ?? "", 10);
  const r = Number.parseInt(parts[2] ?? "", 10);
  const p = Number.parseInt(parts[3] ?? "", 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (n <= 0 || r <= 0 || p <= 0) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] ?? "", "base64");
    expected = Buffer.from(parts[5] ?? "", "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let derived: Buffer;
  try {
    derived = await scrypt(plain, salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
