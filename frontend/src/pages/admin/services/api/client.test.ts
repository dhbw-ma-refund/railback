import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from './client';
import { ApiError } from './errors';
import { clearTokens, setTokens } from '../auth/storage';

const OK_BODY = { hello: 'world' };
const ERR_401 = { error: { code: 'ERR_AUTH_EXPIRED', message: 'gone' } };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiClient', () => {
  beforeEach(() => {
    clearTokens();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTokens();
  });

  it('resolves JSON body on 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    const result = await apiClient.get<typeof OK_BODY>('/ping');
    expect(result).toEqual(OK_BODY);
  });

  it('injects the Authorization header when a token is stored', async () => {
    setTokens('access-xyz', 'refresh', 9999);
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    await apiClient.get('/ping');
    // vi.mocked records the exact RequestInit we passed to fetch; treating
    // that captured value as RequestInit is the "known DOM shape" case.
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-xyz');
  });

  it('omits Authorization when no token is stored', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    await apiClient.get('/ping');
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('serialises the body and sets Content-Type on POST', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    await apiClient.post('/echo', { a: 1 });
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('throws ApiError with parsed body on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(401, ERR_401));
    await expect(apiClient.get('/ping')).rejects.toMatchObject({
      status: 401,
      body: { code: 'ERR_AUTH_EXPIRED', message: 'gone' },
    });
  });

  it('throws ApiError with fallback body on 500 without JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
    try {
      await apiClient.get('/ping');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.body.code).toBe('ERR_UNKNOWN');
    }
  });

  it('appends query parameters, skipping null and undefined', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(200, OK_BODY));
    await apiClient.get('/items', { query: { a: '1', b: null, c: undefined, d: 3 } });
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/items?');
    expect(url).toContain('a=1');
    expect(url).toContain('d=3');
    expect(url).not.toContain('b=');
    expect(url).not.toContain('c=');
  });
});
