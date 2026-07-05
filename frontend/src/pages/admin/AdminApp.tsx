import { Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AdminGuard } from './services/auth/AdminGuard';
import { AppShell } from './shell/AppShell';
import { LoginPage } from './routes/LoginPage';
import { DashboardPage } from './routes/DashboardPage';
import { UsersListPage } from './routes/UsersListPage';
import { UserDetailPage } from './routes/UserDetailPage';
import { TicketsListPage } from './routes/TicketsListPage';
import { TicketDetailPage } from './routes/TicketDetailPage';
import { DelayDrilldownPage } from './routes/DelayDrilldownPage';
import { ToastProvider } from './ui/Toast';

import './mobile.css';

function Guarded({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <AppShell>{children}</AppShell>
    </AdminGuard>
  );
}

/**
 * Root of the /admin-panel/* subtree. Login is public; everything else sits
 * behind AdminGuard and is wrapped in AppShell so the header + logout appear
 * consistently on every authenticated page. ToastProvider wraps everything
 * so any route can surface 5xx errors as toasts.
 */
export function AdminApp() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route
          path=""
          element={
            <Guarded>
              <DashboardPage />
            </Guarded>
          }
        />
        <Route
          path="users"
          element={
            <Guarded>
              <UsersListPage />
            </Guarded>
          }
        />
        <Route
          path="users/:email"
          element={
            <Guarded>
              <UserDetailPage />
            </Guarded>
          }
        />
        <Route
          path="tickets"
          element={
            <Guarded>
              <TicketsListPage />
            </Guarded>
          }
        />
        <Route
          path="tickets/:ticketId"
          element={
            <Guarded>
              <TicketDetailPage />
            </Guarded>
          }
        />
        <Route
          path="tickets/:ticketId/delays"
          element={
            <Guarded>
              <DelayDrilldownPage />
            </Guarded>
          }
        />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </ToastProvider>
  );
}
