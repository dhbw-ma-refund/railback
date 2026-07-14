import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getAccessToken, getExpiry } from './storage';
import { decodeJwt, isExpired } from './jwt';

/**
 * Route wrapper that enforces the three admin invariants at every mount:
 * - access token present in sessionStorage,
 * - token not expired (both stored exp and JWT exp checked),
 * - decoded role === "ADMIN".
 *
 * On any failure we redirect to /admin-panel/login and thread the current
 * pathname through ?next= so LoginPage can restore the target after auth.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const token = getAccessToken();
  const storedExp = getExpiry();
  const payload = token ? decodeJwt(token) : null;

  const nowSec = Date.now() / 1000;
  const storedExpValid = storedExp === null ? true : nowSec < storedExp;
  const authed =
    !!token && !!payload && payload.role === 'ADMIN' && !isExpired(payload) && storedExpValid;

  if (!authed) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin-panel/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
