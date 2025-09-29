import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";

import Overview from "../pages/dashboard/Overview";
import Users from "../pages/dashboard/Users";
import Sessions from "../pages/dashboard/Sessions";
import Deployments from "../pages/dashboard/Deployments";

// PUBLIC_INTERFACE
export default function AppRoutes() {
  /** Application route tree (public only, no authentication required). */
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" />} />

      <Route
        path="/dashboard"
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

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}
