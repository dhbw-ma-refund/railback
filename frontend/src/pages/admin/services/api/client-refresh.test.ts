import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient, setOnRefreshFailed } from './client';
import { clearTokens, getAccessToken, setTokens } from '../auth/storage';
import { makeJwt } from '../auth/__testing__/tokens';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferredResponse(status: number, body: unknown) {
  const { promise, resolve } = Promise.withResolvers<Response>();
  return {
    promise,
    fire: () => resolve(jsonResponse(status, body)),
  };
}

const NEW_ACCESS = makeJwt({ role: 'ADMIN', exp: 9_999_999_999 });

describe('apiClient refresh-on-401', () => {
  beforeEach(() => {
    clearTokens();
    setTokens('old-access', 'refresh-token', 100);
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('retries the original request once after a successful refresh', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: 'ERR_AUTH_EXPIRED', message: 'gone' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          accessToken: NEW_ACCESS,
          refreshToken: 'refresh-2',
          expiresIn: 900,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiClient.get<{ ok: boolean }>('/items');
    expect(result).toEqual({ ok: true });

    // 3 calls: original 401, refresh, retry
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retryInit = fetchMock.mock.calls[2][1] as RequestInit;
    const retryHeaders = retryInit.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe(`Bearer ${NEW_ACCESS}`);
    expect(getAccessToken()).toBe(NEW_ACCESS);
  });

  it('coalesces concurrent 401s onto a single /auth/refresh call', async () => {
    const fetchMock = vi.mocked(fetch);
    const refresh = deferredResponse(200, {
      accessToken: NEW_ACCESS,
      refreshToken: 'refresh-2',
      expiresIn: 900,
    });
    const perUrl = new Map<string, number>();

    fetchMock.mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/auth/refresh')) return refresh.promise;
      const seen = perUrl.get(url) ?? 0;
      perUrl.set(url, seen + 1);
      if (seen === 0) {
        return Promise.resolve(
          jsonResponse(401, { error: { code: 'ERR_AUTH_EXPIRED', message: 'gone' } }),
        );
      }
      return Promise.resolve(jsonResponse(200, { url }));
    });

    const p1 = apiClient.get<{ url: string }>('/items');
    const p2 = apiClient.get<{ url: string }>('/other');

    // Let both 401s land and both queue on the refresh mutex.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    refresh.fire();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.url).toContain('/items');
    expect(r2.url).toContain('/other');

    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });
  it('propagates the 401 and clears storage when refresh POST fails', async () => {
    const fetchMock = vi.mocked(fetch);
    setOnRefreshFailed(() => clearTokens());
    try {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(401, { error: { code: 'ERR_AUTH_EXPIRED', message: 'gone' } }),
        )
        .mockResolvedValueOnce(jsonResponse(400, { error: { code: 'X', message: 'x' } }));

      await expect(apiClient.get('/items')).rejects.toMatchObject({ status: 401 });
      expect(getAccessToken()).toBeNull();
    } finally {
      // Reset the hook so other tests do not inherit the swap.
      setOnRefreshFailed(() => clearTokens());
    }
  });
});
