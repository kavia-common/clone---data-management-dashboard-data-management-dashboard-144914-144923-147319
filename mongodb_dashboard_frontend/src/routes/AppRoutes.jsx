import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Protected } from "../auth/AuthContext";
import AppLayout from "../components/layout/AppLayout";

import Overview from "../pages/dashboard/Overview";
import Users from "../pages/dashboard/Users";
import Sessions from "../pages/dashboard/Sessions";
import Deployments from "../pages/dashboard/Deployments";
import Login from "../pages/Login";
import Register from "../pages/Register";

// PUBLIC_INTERFACE
export default function AppRoutes() {
  /** Application route tree with public and protected sections. */
  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Navigate to="/dashboard" />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      {/* Protected */}
      <Route
        path="/dashboard"
        element={
          <Protected fallback={<Navigate to="/login" />}>
            <AppLayout>
              <Overview />
            </AppLayout>
          </Protected>
        }
      />
      <Route
        path="/dashboard/users"
        element={
          <Protected fallback={<Navigate to="/login" />}>
            <AppLayout>
              <Users />
            </AppLayout>
          </Protected>
        }
      />
      <Route
        path="/dashboard/sessions"
        element={
          <Protected fallback={<Navigate to="/login" />}>
            <AppLayout>
              <Sessions />
            </AppLayout>
          </Protected>
        }
      />
      <Route
        path="/dashboard/deployments"
        element={
          <Protected fallback={<Navigate to="/login" />}>
            <AppLayout>
              <Deployments />
            </AppLayout>
          </Protected>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}
