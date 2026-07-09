// HS256 JWT impl on top of node:crypto. No jsonwebtoken dep — keeps the
// Lambda zip lean and the surface tiny. Tokens are { header.payload.sig }
// where each segment is base64url. Secret + TTLs come from env.

import { createHmac, timingSafeEqual } from "node:crypto";

import { AppError } from "../errors/index.js";
import type { Role } from "../types/enums.js";

export interface AccessClaims {
  sub: string;
  role: Role;
  iat: number;
  exp: number;
}

export interface RefreshClaims extends AccessClaims {
  typ: "refresh";
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;
const HEADER_B64 = b64urlEncode(Buffer.from(JSON.stringify(HEADER)));

// Wrapped so tests can vi.spyOn(jwt, "getNow").
export function getNow(): number {
  return Date.now();
}

function nowSec(): number {
  return Math.floor(getNow() / 1000);
}

function getSecret(): Buffer {
  const raw = process.env.RAILBACK_JWT_SECRET;
  if (!raw) {
    throw new AppError("ERR_INTERNAL", "RAILBACK_JWT_SECRET is not set");
  }
  return Buffer.from(raw, "utf8");
}

function getAccessTtl(): number {
  const raw = process.env.RAILBACK_JWT_ACCESS_TTL_SEC;
  if (!raw) return 900;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppError("ERR_INTERNAL", "RAILBACK_JWT_ACCESS_TTL_SEC must be a positive integer");
  }
  return n;
}

function getRefreshTtl(): number {
  const raw = process.env.RAILBACK_JWT_REFRESH_TTL_SEC;
  if (!raw) return 2_592_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AppError("ERR_INTERNAL", "RAILBACK_JWT_REFRESH_TTL_SEC must be a positive integer");
  }
  return n;
}

export function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(padded, "base64");
}

function sign(headerPayload: string, secret: Buffer): string {
  const mac = createHmac("sha256", secret).update(headerPayload).digest();
  return b64urlEncode(mac);
}

function encodeToken(payload: Record<string, unknown>): string {
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const headerPayload = `${HEADER_B64}.${payloadB64}`;
  const sig = sign(headerPayload, getSecret());
  return `${headerPayload}.${sig}`;
}

export function signAccessToken(input: { email: string; role: Role }): string {
  const iat = nowSec();
  const exp = iat + getAccessTtl();
  const payload: AccessClaims = { sub: input.email, role: input.role, iat, exp };
  return encodeToken(payload as unknown as Record<string, unknown>);
}

export function signRefreshToken(input: { email: string; role: Role }): string {
  const iat = nowSec();
  const exp = iat + getRefreshTtl();
  const payload: RefreshClaims = {
    sub: input.email,
    role: input.role,
    iat,
    exp,
    typ: "refresh",
  };
  return encodeToken(payload as unknown as Record<string, unknown>);
}

function parseAndVerifySignature(token: string): { header: unknown; payload: Record<string, unknown> } {
  if (typeof token !== "string" || token.length === 0) {
    throw new AppError("ERR_AUTH_INVALID", "missing token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AppError("ERR_AUTH_INVALID", "malformed token");
  }
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const headerPayload = `${headerB64}.${payloadB64}`;
  const expected = sign(headerPayload, getSecret());
  const expectedBuf = Buffer.from(expected, "utf8");
  const sigBuf = Buffer.from(sigB64, "utf8");
  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
    throw new AppError("ERR_AUTH_INVALID", "bad signature");
  }
  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(b64urlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    throw new AppError("ERR_AUTH_INVALID", "malformed token payload");
  }
  if (
    typeof header !== "object" ||
    header === null ||
    (header as { alg?: unknown }).alg !== "HS256" ||
    (header as { typ?: unknown }).typ !== "JWT"
  ) {
    throw new AppError("ERR_AUTH_INVALID", "unsupported header");
  }
  if (typeof payload !== "object" || payload === null) {
    throw new AppError("ERR_AUTH_INVALID", "malformed claims");
  }
  return { header, payload: payload as Record<string, unknown> };
}

function assertCommonClaims(payload: Record<string, unknown>): AccessClaims {
  const sub = payload["sub"];
  const role = payload["role"];
  const iat = payload["iat"];
  const exp = payload["exp"];
  if (typeof sub !== "string" || sub.length === 0) {
    throw new AppError("ERR_AUTH_INVALID", "missing sub");
  }
  if (role !== "USER" && role !== "ADMIN") {
    throw new AppError("ERR_AUTH_INVALID", "invalid role claim");
  }
  if (typeof iat !== "number" || typeof exp !== "number") {
    throw new AppError("ERR_AUTH_INVALID", "missing iat/exp");
  }
  if (nowSec() >= exp) {
    throw new AppError("ERR_AUTH_EXPIRED", "token expired");
  }
  return { sub, role, iat, exp };
}

export function verifyAccessToken(token: string): AccessClaims {
  const { payload } = parseAndVerifySignature(token);
  // refresh tokens carry typ:"refresh"; access tokens must not
  if (payload["typ"] === "refresh") {
    throw new AppError("ERR_AUTH_INVALID", "refresh token used as access token");
  }
  return assertCommonClaims(payload);
}

export function verifyRefreshToken(token: string): RefreshClaims {
  // Contract: any refresh-token failure (bad signature / malformed /
  // wrong typ / expired) surfaces as ERR_AUTH_EXPIRED so the frontend
  // takes a single uniform "drop tokens, force re-login" path. See
  // API_CONTRACT_USERFORMS.md POST /auth/refresh errors.
  let payload: Record<string, unknown>;
  try {
    payload = parseAndVerifySignature(token).payload;
    if (payload["typ"] !== "refresh") {
      throw new AppError("ERR_AUTH_EXPIRED", "not a refresh token");
    }
  } catch (err) {
    // Remap any AppError we already raised + any thrown non-AppError to
    // the uniform refresh-failure code.
    if (err instanceof AppError) {
      throw new AppError("ERR_AUTH_EXPIRED", err.message);
    }
    throw new AppError("ERR_AUTH_EXPIRED", "refresh token verification failed");
  }
  // assertCommonClaims throws ERR_AUTH_EXPIRED on expiry already, and
  // ERR_AUTH_INVALID on missing/invalid claim shape — same remap:
  try {
    const base = assertCommonClaims(payload);
    return { ...base, typ: "refresh" };
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError("ERR_AUTH_EXPIRED", err.message);
    }
    throw new AppError("ERR_AUTH_EXPIRED", "refresh token verification failed");
  }
}
