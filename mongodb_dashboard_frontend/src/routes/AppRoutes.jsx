import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";

import Overview from "../pages/dashboard/Overview";
import Users from "../pages/dashboard/Users";
import Sessions from "../pages/dashboard/Sessions";
import Deployments from "../pages/dashboard/Deployments";
import Costs from "../pages/dashboard/Costs";

import Login from "../components/auth/Login";
import ProtectedRoute from "../components/common/ProtectedRoute";

/**
 * PUBLIC_INTERFACE
 * AppRoutes - application route tree with authentication
 */
export default function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />

      {/* Protected */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/overview" replace />} />
        <Route
          path="/overview"
          element={
            <AppLayout>
              <Overview />
            </AppLayout>
          }
        />
        <Route
          path="/dashboard"
          element={<Navigate to="/overview" replace />}
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
      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}
