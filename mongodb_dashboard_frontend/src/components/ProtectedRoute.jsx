import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../config/auth';
import { getActiveTenant } from '../utils/tenantSelection';

// PUBLIC_INTERFACE
export default function ProtectedRoute({ children }) {
  /** Route guard component. Requires authentication and tenant selection. */
  const location = useLocation();
  const authed = isAuthenticated();
  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  const activeTenant = getActiveTenant();
  if (!activeTenant && location.pathname.startsWith('/dashboard')) {
    return <Navigate to="/select-tenant" replace state={{ from: location }} />;
  }
  return children;
}
