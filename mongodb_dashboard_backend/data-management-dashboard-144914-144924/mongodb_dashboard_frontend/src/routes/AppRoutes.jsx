import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "../components/common/ProtectedRoute";

const TenantSelection = lazy(() => import("../pages/TenantSelection.jsx"));

/**
 * Minimal routes to avoid referencing analysis dashboards.
 */
export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route
          path="/select-tenant"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
              <TenantSelection />
            </Suspense>
          }
        />
        <Route path="/" element={<Navigate to="/select-tenant" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/select-tenant" replace />} />
    </Routes>
  );
}
