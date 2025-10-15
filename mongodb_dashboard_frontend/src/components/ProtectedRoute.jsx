import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../config/auth';

// PUBLIC_INTERFACE
export default function ProtectedRoute({ children }) {
  /** Route guard component. Renders children when authenticated; otherwise redirects to /login. */
  const location = useLocation();
  const authed = isAuthenticated();
  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
    }
  return children;
}
