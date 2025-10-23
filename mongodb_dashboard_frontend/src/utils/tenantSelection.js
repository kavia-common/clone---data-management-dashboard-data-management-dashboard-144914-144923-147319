//
// Minimal tenant selection helpers used by routing and pages
//
// PUBLIC_INTERFACE
export function getActiveTenantId() {
  /**
   * Returns the currently active tenantId from localStorage or null.
   * This is a simple placeholder aligned with existing project structure.
   */
  try {
    const val = window.localStorage.getItem('activeTenantId');
    return val || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function setActiveTenantId(tenantId) {
  /**
   * Sets the active tenantId in localStorage.
   * No validation here to keep it minimal; callers should sanitize inputs.
   */
  try {
    if (tenantId) {
      window.localStorage.setItem('activeTenantId', tenantId);
    } else {
      window.localStorage.removeItem('activeTenantId');
    }
  } catch {
    // no-op
  }
}

// PUBLIC_INTERFACE
export function needsTenantSelection(tenants) {
  /**
   * Determines whether user needs to select a tenant:
   * - If there is no active tenant in storage and there are multiple tenants, return true.
   * - Otherwise false.
   */
  const active = getActiveTenantId();
  const count = Array.isArray(tenants) ? tenants.length : 0;
  return !active && count !== 1;
}
