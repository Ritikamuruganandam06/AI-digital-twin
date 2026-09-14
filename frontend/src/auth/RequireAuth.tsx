import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Client-side route gating for UX only -- redirecting an unauthenticated
 * visitor to /login before they see a page that would just 401 anyway.
 * Every actual access-control decision still happens on the backend
 * (`authenticate`/`authorize` middleware) on every request; this
 * component prevents a wasted round trip, it does not replace one.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
