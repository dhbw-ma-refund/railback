/**
 * Login stub. Returns { ok: false } so LoginPage stays functional before the
 * real POST /auth/login wire-up in WP #509. The signature is what the real
 * function will keep, so screens do not change when the stub is swapped out.
 */
export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function login(_email: string, _password: string): Promise<LoginResult> {
  return { ok: false };
}
