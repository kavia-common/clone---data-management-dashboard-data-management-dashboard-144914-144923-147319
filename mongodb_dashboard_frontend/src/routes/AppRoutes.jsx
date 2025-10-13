import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";

import Overview from "../pages/dashboard/Overview";
import Users from "../pages/dashboard/Users";
import Sessions from "../pages/dashboard/Sessions";
import Deployments from "../pages/dashboard/Deployments";
import Costs from "../pages/dashboard/Costs";
import Login from "../pages/Login";
import ProtectedRoute from "../components/common/ProtectedRoute";

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
      <Route path="/login" element={<Login />} />

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
              <Overview />
            </AppLayout>
          }
        />

        <Route
          path="/dashboard/users"
          element={
            <AppLayout>
              <Users />
            </AppLayout>
          }
        />
        <Route
          path="/dashboard/sessions"
          element={
            <AppLayout>
              <Sessions />
            </AppLayout>
          }
        />
        <Route
          path="/dashboard/deployments"
          element={
            <AppLayout>
              <Deployments />
            </AppLayout>
          }
        />
        <Route
          path="/dashboard/costs"
          element={
            <AppLayout>
              <Costs />
            </AppLayout>
          }
        />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  );
}
