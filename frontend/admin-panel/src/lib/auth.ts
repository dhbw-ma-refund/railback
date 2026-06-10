import { createSignal } from 'solid-js';

// Trivial auth state. No real backend — accepts any non-empty
// username/password. Stored in sessionStorage so reloads keep you in.

const KEY = 'admin-panel:session';

const initial = (() => {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { username: string }) : null;
  } catch {
    return null;
  }
})();

const [session, setSession] = createSignal<{ username: string } | null>(initial);

export const auth = {
  session,
  isAuthenticated: () => session() !== null,
  login(username: string, password: string): { ok: true } | { ok: false; error: string } {
    if (!username.trim()) return { ok: false, error: 'Username is required.' };
    if (!password) return { ok: false, error: 'Password is required.' };
    // Accept anything non-empty in the mock.
    const next = { username: username.trim() };
    setSession(next);
    sessionStorage.setItem(KEY, JSON.stringify(next));
    return { ok: true };
  },
  logout() {
    setSession(null);
    sessionStorage.removeItem(KEY);
  },
};
