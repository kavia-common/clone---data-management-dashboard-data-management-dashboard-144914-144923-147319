//
// Centralized Auth and Tenant token provider for client requests.
// Responsible for reading/writing the JWT and tenant_id from storage,
// and exposing helpers for API clients to attach headers consistently.
//

const AUTH_STORAGE_KEY = 'auth';
const ACTIVE_TENANT_KEY = 'activeTenant';

// PUBLIC_INTERFACE
export function getToken() {
  /** Returns the stored JWT token or null if not logged in. */
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const token = parsed?.token || null;
    return token || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function getTenantId() {
  /** Returns the active tenant id (from localStorage activeTenant). */
  try {
    const tid = localStorage.getItem(ACTIVE_TENANT_KEY);
    return tid || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function setFromLoginResponse({ token, tenant_id }) {
  /**
   * Sets auth token and optionally tenant_id from the login response.
   * - token is required for logged-in state
   * - tenant_id, if present, will be mirrored into activeTenant
   */
  try {
    if (token) {
      const data = { loggedIn: true, token };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    } else {
      // Minimal loggedIn state for cookie-based flows
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ loggedIn: true }));
    }
  } catch {
    // ignore storage errors
  }

  if (tenant_id) {
    try {
      localStorage.setItem(ACTIVE_TENANT_KEY, String(tenant_id));
    } catch {
      // ignore
    }
  }
}

// PUBLIC_INTERFACE
export function setActiveTenantId(tenantId) {
  /** Persist active tenant id to localStorage and keep it consistent. */
  try {
    if (tenantId) localStorage.setItem(ACTIVE_TENANT_KEY, String(tenantId));
    else localStorage.removeItem(ACTIVE_TENANT_KEY);
  } catch {
    // ignore
  }
}

// PUBLIC_INTERFACE
export function clearAuth() {
  /** Clears auth token and leaves tenant selection untouched by default. */
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * PUBLIC_INTERFACE
 * buildAuthHeaders
 * Builds headers with Authorization when available. Intentionally does NOT include any tenant header.
 * Tenant scoping must be provided via the tenant_id query parameter which is appended by the shared API clients.
 */
export function buildAuthHeaders(baseHeaders = {}) {
  const headers = { ...(baseHeaders || {}) };

  const token = getToken();
  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  // Note: We no longer set 'X-Tenant-Id'. Tenant is appended as a query param elsewhere.

  return headers;
}
