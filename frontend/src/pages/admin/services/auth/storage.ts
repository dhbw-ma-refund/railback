/**
 * Session-scoped token storage for admin credentials. Uses sessionStorage
 * (not localStorage) so a closed tab logs out. Keys are namespaced with
 * "admin." to keep the main app free of admin state.
 */
const ACCESS_KEY = 'admin.access';
const REFRESH_KEY = 'admin.refresh';
const EXP_KEY = 'admin.exp';

export function getAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_KEY);
}

export function getExpiry(): number | null {
  const raw = sessionStorage.getItem(EXP_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function setTokens(access: string, refresh: string, exp: number): void {
  sessionStorage.setItem(ACCESS_KEY, access);
  sessionStorage.setItem(REFRESH_KEY, refresh);
  sessionStorage.setItem(EXP_KEY, String(exp));
}

export function clearTokens(): void {
  sessionStorage.removeItem(ACCESS_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  sessionStorage.removeItem(EXP_KEY);
}
