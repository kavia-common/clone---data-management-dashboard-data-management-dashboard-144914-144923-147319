//
// Minimal tenant selection helpers (legacy) kept for backward compatibility.
// Prefer using utils/tenantClient.js going forward.
//
/**
 * PUBLIC_INTERFACE
 * getActiveTenantId
 * Reads active tenant using new key 'activeTenant', falling back to legacy 'activeTenantId'.
 */
export function getActiveTenantId() {
  try {
    const preferred = window.localStorage.getItem('activeTenant');
    if (preferred) return preferred;
    const legacy = window.localStorage.getItem('activeTenantId');
    return legacy || null;
  } catch {
    return null;
  }
}

/**
 * PUBLIC_INTERFACE
 * setActiveTenantId
 * Writes the active tenant using the new key 'activeTenant' and cleans up legacy key.
 */
export function setActiveTenantId(tenantId) {
  try {
    if (tenantId) {
      window.localStorage.setItem('activeTenant', String(tenantId));
    } else {
      window.localStorage.removeItem('activeTenant');
    }
    window.localStorage.removeItem('activeTenantId');
  } catch {
    // no-op
  }
}

/**
 * PUBLIC_INTERFACE
 * needsTenantSelection
 * Determines if tenant selection UI is needed when there is not exactly one tenant.
 */
export function needsTenantSelection(tenants) {
  const active = getActiveTenantId();
  const count = Array.isArray(tenants) ? tenants.length : 0;
  return !active && count !== 1;
}
