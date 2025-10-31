const STORAGE_KEY = 'activeTenant';

// PUBLIC_INTERFACE
export function getActiveTenant() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function setActiveTenantLocal(tenantId) {
  try {
    if (tenantId) localStorage.setItem(STORAGE_KEY, tenantId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// PUBLIC_INTERFACE
export function clearActiveTenantLocal() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
