import { apiClient } from '../api/client';
import { ApiError, ERR_AUTH_INVALID } from '../api/errors';
import { clearTokens, setTokens } from './storage';
import { decodeJwt } from './jwt';

/**
 * Login result the LoginPage consumes. Message is the exact string to render;
 * screens never re-interpret backend codes locally.
 */
export interface LoginResult {
  ok: boolean;
  error?: string;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function isLoginResponse(value: unknown): value is LoginResponse {
  if (!value || typeof value !== 'object') return false;
  if (!('accessToken' in value) || typeof value.accessToken !== 'string') return false;
  if (!('refreshToken' in value) || typeof value.refreshToken !== 'string') return false;
  if (!('expiresIn' in value) || typeof value.expiresIn !== 'number') return false;
  return true;
}

const MSG_INVALID_CREDS = 'E-Mail oder Passwort falsch';
const MSG_NOT_ADMIN = 'Dieses Konto ist kein Admin-Konto';
const MSG_GENERIC = 'Anmeldung fehlgeschlagen. Bitte später erneut versuchen.';

export async function login(email: string, password: string): Promise<LoginResult> {
  try {
    const raw = await apiClient.post<unknown>('/auth/login', { email, password });
    if (!isLoginResponse(raw)) {
      return { ok: false, error: MSG_GENERIC };
    }

    const payload = decodeJwt(raw.accessToken);
    if (!payload || payload.role !== 'ADMIN') {
      clearTokens();
      return { ok: false, error: MSG_NOT_ADMIN };
    }

    const exp = payload.exp ?? Math.floor(Date.now() / 1000) + raw.expiresIn;
    setTokens(raw.accessToken, raw.refreshToken, exp);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.code === ERR_AUTH_INVALID) {
        return { ok: false, error: MSG_INVALID_CREDS };
      }
    }
    return { ok: false, error: MSG_GENERIC };
  }
}

export { clearTokens };
