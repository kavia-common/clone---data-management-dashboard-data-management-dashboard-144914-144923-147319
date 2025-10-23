import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../config/auth';
import { getActiveTenantId } from '../utils/tenantSelection';

// PUBLIC_INTERFACE
export default function ProtectedRoute({ children }) {
  /** Route guard component. Requires authentication and tenant selection. */
  const location = useLocation();
  const authed = isAuthenticated();

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const activeTenantId = getActiveTenantId();

  // Only enforce tenant selection for dashboard routes, allow /select-tenant itself
  const isDashboardPath = location.pathname.startsWith('/dashboard');
  const isTenantSelect = location.pathname === '/select-tenant';

  if (!activeTenantId && isDashboardPath && !isTenantSelect) {
    return <Navigate to="/select-tenant" replace state={{ from: location }} />;
  }

  // If a child is provided, render it; otherwise render nested routes via Outlet
  return children ?? <Outlet />;
}
