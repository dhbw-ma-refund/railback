/**
 * Persistent token storage for user-facing credentials.
 *
 * Uses localStorage (a closed tab keeps you logged in) — deliberately
 * different from the admin panel's sessionStorage (see
 * src/pages/admin/services/auth/storage.ts). Keys are namespaced with
 * "user." so the admin and user token stores never collide, and so a
 * future cleanup of the pre-migration bare keys is a clean grep.
 *
 * A one-shot migration on module load copies the legacy bare keys
 * (accessToken/refreshToken/user) over so anyone who is signed in on
 * a running build stays signed in through this change.
 */
const ACCESS_KEY = 'user.access';
const REFRESH_KEY = 'user.refresh';
const EXP_KEY = 'user.exp';
const PROFILE_KEY = 'user.profile';

const LEGACY_ACCESS_KEY = 'accessToken';
const LEGACY_REFRESH_KEY = 'refreshToken';
const LEGACY_PROFILE_KEY = 'user';

function migrateLegacyKeys(): void {
  if (typeof localStorage === 'undefined') return;
  const legacyAccess = localStorage.getItem(LEGACY_ACCESS_KEY);
  const legacyRefresh = localStorage.getItem(LEGACY_REFRESH_KEY);
  const legacyProfile = localStorage.getItem(LEGACY_PROFILE_KEY);
  // Only migrate when at least one namespaced key is missing — avoids
  // clobbering a fresh login that lived alongside stale legacy keys.
  const alreadyMigrated = localStorage.getItem(ACCESS_KEY) !== null;
  if (!alreadyMigrated && legacyAccess) {
    localStorage.setItem(ACCESS_KEY, legacyAccess);
    if (legacyRefresh) localStorage.setItem(REFRESH_KEY, legacyRefresh);
    if (legacyProfile) localStorage.setItem(PROFILE_KEY, legacyProfile);
    // Expiry wasn't tracked in the legacy scheme. Leaving it unset means the
    // AuthContext mount check will treat the token as decode-only and
    // trigger a refresh on the first 401 — acceptable for a one-shot copy.
  }
  // Always remove the legacy keys so future logouts don't leave stragglers.
  localStorage.removeItem(LEGACY_ACCESS_KEY);
  localStorage.removeItem(LEGACY_REFRESH_KEY);
  localStorage.removeItem(LEGACY_PROFILE_KEY);
}

migrateLegacyKeys();

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getExpiry(): number | null {
  const raw = localStorage.getItem(EXP_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function setTokens(access: string, refresh: string, exp: number): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
  localStorage.setItem(EXP_KEY, String(exp));
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXP_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

export function getStoredProfile<T>(): T | null {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredProfile<T>(profile: T): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function clearStoredProfile(): void {
  localStorage.removeItem(PROFILE_KEY);
}
