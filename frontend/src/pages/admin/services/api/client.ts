import { ApiError, ERR_AUTH_EXPIRED, parseErrorBody } from './errors';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../auth/storage';
import { decodeJwt } from '../auth/jwt';

/**
 * Minimal typed fetch wrapper with a single-shot refresh on 401.
 *
 * - Base URL from VITE_API_BASE_URL (falls back to the prod Lambda URL).
 * - Access token injected from sessionStorage per call.
 * - Non-2xx → ApiError with a normalised body.
 * - On 401 with ERR_AUTH_EXPIRED: acquire a shared refresh promise, POST
 *   /auth/refresh, replay the original request exactly once with the new
 *   access token. A second 401 on the retry propagates as-is.
 * - Concurrent 401s coalesce onto the same in-flight refresh: only one
 *   /auth/refresh is ever fired for a burst of expired requests.
 */
export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Internal marker to prevent infinite refresh loops. */
  _retried?: boolean;
}

const DEFAULT_BASE_URL = 'https://ckmhi46i2xidpl7joik5hby2ba0vhlso.lambda-url.eu-north-1.on.aws';

function baseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_BASE_URL;
  return typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : DEFAULT_BASE_URL;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = baseUrl().replace(/\/$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${rel}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readJsonSafely(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Shared refresh mutex — a single in-flight refresh serves every waiter. */
let refreshMutex: Promise<boolean> | null = null;

async function performRefresh(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  const url = `${baseUrl().replace(/\/$/, '')}/auth/refresh`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: refresh }),
    });
    if (!res.ok) return false;
    const payload = await readJsonSafely(res);
    if (!payload || typeof payload !== 'object') return false;
    if (!('accessToken' in payload) || typeof payload.accessToken !== 'string') return false;
    if (!('refreshToken' in payload) || typeof payload.refreshToken !== 'string') return false;
    const accessToken = payload.accessToken;
    const refreshTokenOut = payload.refreshToken;
    const exp = decodeJwt(accessToken)?.exp ?? Math.floor(Date.now() / 1000) + 900;
    setTokens(accessToken, refreshTokenOut, exp);
    return true;
  } catch {
    return false;
  }
}

/** Wait for any in-flight refresh, or start a fresh one. Returns success. */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshMutex) {
    refreshMutex = performRefresh().finally(() => {
      refreshMutex = null;
    });
  }
  return refreshMutex;
}

/**
 * Fires after a failed refresh. Overridable so tests do not need to redefine
 * window.location, which is non-configurable in jsdom.
 */
let onRefreshFailedHook: () => void = () => {
  clearTokens();
  if (typeof window !== 'undefined') {
    window.location.replace('/admin-panel/login');
  }
};

export function setOnRefreshFailed(hook: () => void): void {
  onRefreshFailedHook = hook;
}

export async function request<T>(
  method: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(opts.headers ?? {}),
  };

  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const init: RequestInit = { method, headers, signal: opts.signal };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(buildUrl(path, opts.query), init);
  const payload = await readJsonSafely(res);

  if (res.status === 401 && !opts._retried) {
    const body = parseErrorBody(payload, 401);
    // Only refresh for token-expiry style codes; a wrong-password 401 must
    // still surface as ApiError so LoginPage can render its own message.
    const shouldRefresh = body.code === ERR_AUTH_EXPIRED || body.code === 'ERR_UNKNOWN';
    if (shouldRefresh && getRefreshToken()) {
      const ok = await refreshAccessToken();
      if (ok) {
        return request<T>(method, path, { ...opts, _retried: true });
      }
      onRefreshFailedHook();
      throw new ApiError(401, body);
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, parseErrorBody(payload, res.status));
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('POST', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>('PATCH', path, { ...opts, body }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
