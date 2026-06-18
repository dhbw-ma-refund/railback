import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { login } from './index';
import { clearTokens, getAccessToken } from './storage';
import { makeJwt } from './__testing__/tokens';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ADMIN_JWT = makeJwt({ role: 'ADMIN', sub: 'a@b', exp: 2_000_000_000 });
const USER_JWT = makeJwt({ role: 'USER', sub: 'u@b', exp: 2_000_000_000 });

describe('login', () => {
  beforeEach(() => {
    clearTokens();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('stores tokens and returns ok on ADMIN login', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { accessToken: ADMIN_JWT, refreshToken: 'refresh', expiresIn: 900 }),
    );
    const result = await login('admin@x', 'pw');
    expect(result).toEqual({ ok: true });
    expect(getAccessToken()).not.toBeNull();
  });

  it('rejects USER role and leaves storage empty', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(200, { accessToken: USER_JWT, refreshToken: 'refresh', expiresIn: 900 }),
    );
    const result = await login('user@x', 'pw');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Dieses Konto ist kein Admin-Konto');
    expect(getAccessToken()).toBeNull();
  });

  it('surfaces invalid-credential message on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 'ERR_AUTH_INVALID', message: 'nope' } }),
    );
    const result = await login('admin@x', 'wrong');
    expect(result).toEqual({ ok: false, error: 'E-Mail oder Passwort falsch' });
  });

  it('falls back to generic message on 500', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(500, { error: { code: 'X', message: 'y' } }),
    );
    const result = await login('admin@x', 'pw');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Anmeldung fehlgeschlagen. Bitte später erneut versuchen.');
  });
});
