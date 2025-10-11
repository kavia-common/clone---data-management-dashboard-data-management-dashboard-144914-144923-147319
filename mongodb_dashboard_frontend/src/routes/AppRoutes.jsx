import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "../components/layout/AppLayout";

import Overview from "../pages/dashboard/Overview";
import Users from "../pages/dashboard/Users";
import Sessions from "../pages/dashboard/Sessions";
import Deployments from "../pages/dashboard/Deployments";
import Costs from "../pages/dashboard/Costs";
import Login from "../pages/Login";

// PUBLIC_INTERFACE
export default function AppRoutes() {
  /**
   * Application route tree under a single root BrowserRouter (provided by index.js).
   * Includes public /login and dashboard routes.
   */
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />

      {/* Dashboard routes */}
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
      <Route
        path="/dashboard/costs"
        element={
          <AppLayout>
            <Costs />
          </AppLayout>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}
