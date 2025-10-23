import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";
import Skeleton from "../components/ui/Skeleton.jsx";
import ProtectedRoute from "../components/common/ProtectedRoute";
import TenantBootstrapGate from "../components/common/TenantBootstrapGate";

const Overview = lazy(() => import("../pages/dashboard/Overview"));
const Users = lazy(() => import("../pages/dashboard/Users"));
const Sessions = lazy(() => import("../pages/dashboard/Sessions"));
const Deployments = lazy(() => import("../pages/dashboard/Deployments"));
const Costs = lazy(() => import("../pages/dashboard/Costs"));
const Login = lazy(() => import("../pages/Login"));
const TenantSelection = lazy(() => import("../pages/TenantSelection"));

/**
 * NeutralLanding
 * A neutral, protected landing that renders nothing. TenantBootstrapGate handles navigation.
 */
function NeutralLanding() {
  return <div style={{ padding: 24 }} aria-live="polite"><Skeleton width="100%" height={120} /></div>;
}

/**
 * PUBLIC_INTERFACE
 * Application route tree under a single root BrowserRouter (provided by index.js).
 * - /login remains public.
 * - All protected routes are wrapped by ProtectedRoute and TenantBootstrapGate so tenant logic runs first.
 */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route
        path="/login"
        element={
          <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={180} /></div>}>
            <Login />
          </Suspense>
        }
      />

      {/* Protected routes wrapper; ProtectedRoute renders an Outlet when authed */}
      <Route element={<ProtectedRoute />}>
        {/* Mount TenantBootstrap at the root of protected routes */}
        <Route element={<TenantBootstrapGate />}>
          {/* Neutral landings that let bootstrap decide where to go */}
          <Route path="/" element={<NeutralLanding />} />
          <Route path="/dashboard" element={<NeutralLanding />} />

          {/* Tenant selection route (protected) */}
          <Route
            path="/tenant/select"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={160} /></div>}>
                  <TenantSelection />
                </Suspense>
              </AppLayout>
            }
          />

          {/* Explicit dashboard routes */}
          <Route
            path="/dashboard/overview"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={280} /></div>}>
                  <Overview />
                </Suspense>
              </AppLayout>
            }
          />
          <Route
            path="/dashboard/users"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={280} /></div>}>
                  <Users />
                </Suspense>
              </AppLayout>
            }
          />
          <Route
            path="/dashboard/sessions"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={320} /></div>}>
                  <Sessions />
                </Suspense>
              </AppLayout>
            }
          />
          <Route
            path="/dashboard/deployments"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={320} /></div>}>
                  <Deployments />
                </Suspense>
              </AppLayout>
            }
          />
          <Route
            path="/dashboard/costs"
            element={
              <AppLayout>
                <Suspense fallback={<div style={{ padding: 24 }}><Skeleton width="100%" height={280} /></div>}>
                  <Costs />
                </Suspense>
              </AppLayout>
            }
          />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
