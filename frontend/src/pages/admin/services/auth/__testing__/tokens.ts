/**
 * Test-only JWT builder. Uses browser-native btoa (available in jsdom).
 */
function b64url(raw: string): string {
  return btoa(raw).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function makeJwt(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}
