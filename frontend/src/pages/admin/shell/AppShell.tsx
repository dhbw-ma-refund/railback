import type { ReactNode } from 'react';
import { AdminHeader } from './AdminHeader';

/**
 * Wraps authenticated admin routes with the header. Kept intentionally thin
 * so the router file stays legible.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AdminHeader />
      {children}
    </>
  );
}
