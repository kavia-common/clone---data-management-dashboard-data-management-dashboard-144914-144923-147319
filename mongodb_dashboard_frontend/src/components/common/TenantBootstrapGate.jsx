import React from 'react';
import { Outlet } from 'react-router-dom';
import TenantBootstrap from '../TenantBootstrap';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-ROUTING-003
// User Story: Ensure TenantBootstrap runs before any dashboard redirects by mounting at the root of protected routes.
// Acceptance Criteria:
// - Gate wraps all protected routes and mounts TenantBootstrap exactly once.
// - Allows nested routes to render via Outlet.
// - Avoids double navigation by deferring to TenantBootstrap's own guard.
// GxP Impact: NO (routing orchestration only)
// Risk Level: LOW
// Validation Protocol: VP-FE-TENANT-ROUTING
// ============================================================================ */

/**
 * PUBLIC_INTERFACE
 * TenantBootstrapGate
 * Wraps protected routes to ensure tenant bootstrap logic executes before rendering content.
 * Renders an Outlet for nested content.
 */
export default function TenantBootstrapGate() {
  return (
    <>
      <TenantBootstrap />
      <Outlet />
    </>
  );
}
