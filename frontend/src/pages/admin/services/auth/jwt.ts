/**
 * Base64URL-decode a JWT payload without signature verification. Verification
 * is a backend responsibility (API gateway); the frontend only reads exp/role
 * so it can gate UI and pre-empt obvious 401s.
 */
export interface JwtPayload {
  sub?: string;
  role?: string;
  exp?: number;
  iat?: number;
  typ?: string;
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 2 ? '==' : input.length % 4 === 3 ? '=' : '';
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return atob(b64);
}

export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const raw = base64UrlDecode(parts[1]);
    const json = decodeURIComponent(
      Array.from(raw, (ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
    );
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object') return null;
    const out: JwtPayload = {};
    if ('sub' in parsed && typeof parsed.sub === 'string') out.sub = parsed.sub;
    if ('role' in parsed && typeof parsed.role === 'string') out.role = parsed.role;
    if ('exp' in parsed && typeof parsed.exp === 'number') out.exp = parsed.exp;
    if ('iat' in parsed && typeof parsed.iat === 'number') out.iat = parsed.iat;
    if ('typ' in parsed && typeof parsed.typ === 'string') out.typ = parsed.typ;
    return out;
  } catch {
    return null;
  }
}

export function isExpired(payload: JwtPayload | null, now = Date.now()): boolean {
  if (!payload || typeof payload.exp !== 'number') return true;
  return now / 1000 >= payload.exp;
}
