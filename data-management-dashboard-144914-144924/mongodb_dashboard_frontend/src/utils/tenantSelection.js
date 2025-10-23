//
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-SELECT-001
// User Story: After login, users with multiple tenants should be prompted to select a tenant; if one, auto-select; if none, show message.
// Acceptance Criteria:
//  - Fetch accessible tenants from GET /api/session/tenants or GET /api/tenants?authorized=true
//  - POST selection to /api/tenants/select with { tenantId, reason? }
//  - Persist selection in localStorage and cookie provided by backend
// GxP Impact: YES - Ensures correct scoping and audit via backend.
// Risk Level: MEDIUM
// Validation Protocol: VP-FE-TENANT-SELECT-001
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
import apiClient from '../api/client';

/**
// PUBLIC_INTERFACE
 * listAccessibleTenants
 * Returns array of { id, name } tenants for the current user.
 */
export async function listAccessibleTenants() {
  // Prefer the session endpoint, fallback to tenants authorized listing
  try {
    const res = await apiClient.get('/api/session/tenants');
    if (res?.data?.items) return res.data.items;
  } catch (e) {
    // ignore and fallback
  }
  const res2 = await apiClient.get('/api/tenants?authorized=true');
  return res2?.data?.items || [];
}

/**
// PUBLIC_INTERFACE
 * selectTenant
 * Persists selection via backend and stores locally.
 * @param {string} tenantId - required
 * @param {string} reason - optional
 */
export async function selectTenant(tenantId, reason) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId is required');
  }
  const res = await apiClient.post('/api/tenants/select', { tenantId, reason });
  const active = res?.data?.activeTenant || tenantId;
  localStorage.setItem('activeTenant', active);
  return active;
}

/**
// PUBLIC_INTERFACE
 * getActiveTenant
 * Returns active tenant id from localStorage, falling back to cookie if accessible.
 */
export function getActiveTenant() {
  const t = localStorage.getItem('activeTenant');
  if (t) return t;
  // Cookie fallback (non-HTTPOnly by backend), best-effort
  const m = document.cookie.match(/(?:^|; )activeTenant=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
// PUBLIC_INTERFACE
 * clearActiveTenant
 * Removes client-side selection.
 */
export function clearActiveTenant() {
  localStorage.removeItem('activeTenant');
}
