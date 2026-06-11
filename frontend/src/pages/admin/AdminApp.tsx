import { Routes, Route, Navigate } from 'react-router-dom';
import { AdminGuard } from './services/auth/AdminGuard';
import { LoginPage } from './routes/LoginPage';
import { DashboardPage } from './routes/DashboardPage';
import { UsersListPage } from './routes/UsersListPage';
import { UserDetailPage } from './routes/UserDetailPage';
import { TicketsListPage } from './routes/TicketsListPage';
import { TicketDetailPage } from './routes/TicketDetailPage';

/**
 * Root of the /admin-panel/* subtree.
 *
 * Login is the only public route; everything else sits behind AdminGuard.
 */
export function AdminApp() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route
        path=""
        element={
          <AdminGuard>
            <DashboardPage />
          </AdminGuard>
        }
      />
      <Route
        path="users"
        element={
          <AdminGuard>
            <UsersListPage />
          </AdminGuard>
        }
      />
      <Route
        path="users/:email"
        element={
          <AdminGuard>
            <UserDetailPage />
          </AdminGuard>
        }
      />
      <Route
        path="tickets"
        element={
          <AdminGuard>
            <TicketsListPage />
          </AdminGuard>
        }
      />
      <Route
        path="tickets/:ticketId"
        element={
          <AdminGuard>
            <TicketDetailPage />
          </AdminGuard>
        }
      />
      <Route path="*" element={<Navigate to="" replace />} />
    </Routes>
  );
}
