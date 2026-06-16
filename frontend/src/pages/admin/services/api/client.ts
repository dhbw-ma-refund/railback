import { ApiError, parseErrorBody } from './errors';
import { getAccessToken } from '../auth/storage';

/**
 * Minimal typed fetch wrapper.
 *
 * - Base URL comes from VITE_API_BASE_URL (falls back to the mock at :16704).
 * - Access token is injected from sessionStorage when present.
 * - Non-2xx responses become ApiError with a normalised body.
 * - 204 and empty bodies resolve to `undefined` cast to T; callers that
 *   expect an empty response should use `T = void`.
 *
 * Refresh-on-401 wiring is intentionally deferred to WP #511.
 */
export interface RequestOptions {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'http://localhost:16704/v1';

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
