import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, loading } = useAuth();
  // Suppress the redirect during the mount-time token/refresh probe so a
  // valid session isn't kicked to /login on the first render.
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};
