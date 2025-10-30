import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";
import Skeleton from "../components/ui/Skeleton.jsx";
import ProtectedRoute from "../components/common/ProtectedRoute";

const Overview = lazy(() => import("../pages/dashboard/Overview"));
const Users = lazy(() => import("../pages/dashboard/Users"));
const Sessions = lazy(() => import("../pages/dashboard/Sessions"));
const Deployments = lazy(() => import("../pages/dashboard/Deployments"));
const Costs = lazy(() => import("../pages/dashboard/Costs"));

const Login = lazy(() => import("../pages/Login"));

/**
 * PUBLIC_INTERFACE
 * Application route tree under a single root BrowserRouter (provided by index.js).
 * - /login remains public.
 * - All dashboard routes are guarded by ProtectedRoute.
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
        {/* Default root redirects to dashboard overview */}
        <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />

        {/* Keep /dashboard for backward-compatibility: redirect to /dashboard/overview */}
        <Route path="/dashboard" element={<Navigate to="/dashboard/overview" replace />} />

        {/* New explicit overview route */}
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

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  );
}
