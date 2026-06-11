import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Skeleton auth guard.
 *
 * Real check (JWT presence + expiry + role) lands with WP #510. For now we
 * unconditionally redirect to /admin-panel/login, so unauthenticated users
 * see a defined landing surface while the router shape is wired up.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const location = useLocation();
  const authed = false;
  if (!authed) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/admin-panel/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
