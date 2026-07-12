import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearTokens,
  getAccessToken,
  getExpiry,
  getRefreshToken,
  setTokens,
} from './storage';

/**
 * The incoming merge of origin/frontend introduces an AuthProvider that
 * stores marketing-side tokens in localStorage under the keys "accessToken",
 * "refreshToken", and "user". Admin session tokens live in sessionStorage
 * under "admin.access", "admin.refresh", "admin.exp". These tests lock the
 * isolation so a marketing login can never authenticate the admin panel
 * (and vice versa).
 *
 * The Bun test runner's DOM shim ships sessionStorage but not localStorage,
 * so we polyfill localStorage with a minimal in-memory Storage before the
 * suite runs. This mirrors the merged tree's marketing surface without
 * depending on the real browser API.
 */
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  } satisfies Storage;
}

describe('admin auth storage isolation', () => {
  beforeAll(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: makeMemoryStorage(),
      });
    }
  });

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  it('writes admin tokens to sessionStorage under namespaced keys', () => {
    setTokens('access-1', 'refresh-1', 12345);
    expect(sessionStorage.getItem('admin.access')).toBe('access-1');
    expect(sessionStorage.getItem('admin.refresh')).toBe('refresh-1');
    expect(sessionStorage.getItem('admin.exp')).toBe('12345');
  });

  it('never writes admin tokens to localStorage under admin OR marketing keys', () => {
    setTokens('a', 'r', 42);
    expect(localStorage.getItem('admin.access')).toBeNull();
    expect(localStorage.getItem('admin.refresh')).toBeNull();
    expect(localStorage.getItem('admin.exp')).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('ignores marketing-side localStorage tokens when no admin session exists', () => {
    localStorage.setItem('accessToken', 'marketing-access');
    localStorage.setItem('refreshToken', 'marketing-refresh');
    localStorage.setItem('user', '{"email":"user@example.com"}');

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getExpiry()).toBeNull();
  });

  it('returns the admin session even while marketing tokens sit in localStorage', () => {
    localStorage.setItem('accessToken', 'marketing-access');
    setTokens('admin-access', 'admin-refresh', 999);

    expect(getAccessToken()).toBe('admin-access');
    expect(getRefreshToken()).toBe('admin-refresh');
    expect(getExpiry()).toBe(999);
  });

  it('clearTokens removes only the admin keys and leaves marketing localStorage intact', () => {
    setTokens('a', 'r', 1);
    localStorage.setItem('accessToken', 'marketing-access');
    localStorage.setItem('user', '{"id":1}');

    clearTokens();

    expect(sessionStorage.getItem('admin.access')).toBeNull();
    expect(sessionStorage.getItem('admin.refresh')).toBeNull();
    expect(sessionStorage.getItem('admin.exp')).toBeNull();
    expect(localStorage.getItem('accessToken')).toBe('marketing-access');
    expect(localStorage.getItem('user')).toBe('{"id":1}');
  });

  it('getExpiry returns null for missing, non-numeric, or NaN values', () => {
    expect(getExpiry()).toBeNull();

    sessionStorage.setItem('admin.exp', 'nope');
    expect(getExpiry()).toBeNull();

    sessionStorage.setItem('admin.exp', 'NaN');
    expect(getExpiry()).toBeNull();
  });

  it('getExpiry returns the numeric value for well-formed timestamps', () => {
    setTokens('a', 'r', 1_700_000_000);
    expect(getExpiry()).toBe(1_700_000_000);
  });
});
