import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * PUBLIC_INTERFACE
 * ProtectedRoute guards routes that require authentication.
 * If unauthenticated, redirects to /login and preserves the original path in state.
 * Enforces tenant selection by redirecting to /select-tenant if no active tenant is present.
 */
export default function ProtectedRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Require active tenant selection post-login; allow selection page itself
  try {
    const activeTenant = localStorage.getItem('activeTenant');
    const isSelecting = location.pathname === '/select-tenant';
    if (!activeTenant && !isSelecting) {
      return <Navigate to="/select-tenant" replace state={{ from: location }} />;
    }
  } catch {
    // ignore storage access failures
  }

  return <Outlet />;
}
