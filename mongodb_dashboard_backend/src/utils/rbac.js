'use strict';

/**
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-BE-RBAC-001
// User Story: As a system, I must ensure users can only select tenants they belong to.
// Acceptance Criteria:
//  - Validate tenant membership when setting active tenant
//  - Support tenants shaped as array<string> or array<{ id, name, role? }>
// GxP Impact: YES - Access controls.
// Risk Level: MEDIUM
// Validation Protocol: VP-BE-RBAC-001
// ============================================================================
 */

/**
 * PUBLIC_INTERFACE
 * Check if the provided user has access to a given tenantId.
 * Supports tenants stored as:
 *  - ['t1', 't2']
 *  - [{ id: 't1', name: 'Tenant 1', role: 'admin' }, ...]
 */
function userHasTenant(user, tenantId) {
  if (!user || !tenantId) return false;
  const t = (user.tenants && Array.isArray(user.tenants)) ? user.tenants : [];

  return t.some((item) => {
    if (typeof item === 'string') return item === tenantId;
    if (item && typeof item === 'object') {
      return item.id === tenantId || item.tenant_id === tenantId || item._id === tenantId;
    }
    return false;
  });
}

/**
 * PUBLIC_INTERFACE
 * Normalize a user's tenants to array of { id, name } for response payloads.
 */
function normalizeUserTenants(user) {
  const arr = Array.isArray(user?.tenants) ? user.tenants : [];
  return arr
    .map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      if (item && typeof item === 'object') {
        const id = item.id || item.tenant_id || item._id || null;
        const name = item.name || item.tenant_name || id || 'Unknown';
        return id ? { id, name } : null;
      }
      return null;
    })
    .filter(Boolean);
}

module.exports = {
  userHasTenant,
  normalizeUserTenants,
};
