/*
 Centralized Auth and Organization token provider for client requests.
 Responsible for reading/writing the JWT and organization_id from storage,
 and exposing helpers for API clients to attach headers consistently.
*/

const AUTH_STORAGE_KEY = 'auth';
const ACTIVE_ORG_KEY = 'activeOrganization';
const ACTIVE_TENANT_KEY = 'activeTenant'; // legacy alias kept for backward compatibility

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

/**
 * PUBLIC_INTERFACE
 * getOrganizationId
 * Returns the active organization_id from localStorage.
 * Prefers ACTIVE_ORG_KEY; falls back to legacy ACTIVE_TENANT_KEY.
 */
export function getOrganizationId() {
  try {
    const oid = localStorage.getItem(ACTIVE_ORG_KEY);
    if (oid) return oid;
    const legacy = localStorage.getItem(ACTIVE_TENANT_KEY);
    return legacy || null;
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function getTenantId() {
  /** Legacy helper: returns organization_id using previous name. */
  return getOrganizationId();
}

/**
 * PUBLIC_INTERFACE
 * setFromLoginResponse
 * Sets auth token and optionally organization_id from the login response.
 * - token is required for logged-in state
 * - organization_id, if present, will be mirrored into activeOrganization (and legacy activeTenant for compat)
 */
export function setFromLoginResponse({ token, organization_id, tenant_id } = {}) {
  try {
    if (token) {
      const data = { loggedIn: true, token };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ loggedIn: true }));
    }
  } catch {
    // ignore storage errors
  }

  const org = organization_id || tenant_id || null;
  if (org) {
    try {
      localStorage.setItem(ACTIVE_ORG_KEY, String(org));
      // keep legacy mirror for any scattered reads
      localStorage.setItem(ACTIVE_TENANT_KEY, String(org));
    } catch {
      // ignore
    }
  }
}

/**
 * PUBLIC_INTERFACE
 * setActiveOrganizationId
 * Persist active organization id to localStorage and keep legacy key in sync.
 */
export function setActiveOrganizationId(organizationId) {
  try {
    if (organizationId) {
      localStorage.setItem(ACTIVE_ORG_KEY, String(organizationId));
      localStorage.setItem(ACTIVE_TENANT_KEY, String(organizationId)); // legacy mirror
    } else {
      localStorage.removeItem(ACTIVE_ORG_KEY);
      localStorage.removeItem(ACTIVE_TENANT_KEY);
    }
  } catch {
    // ignore
  }
}

// PUBLIC_INTERFACE
export function setActiveTenantId(tenantId) {
  /** Legacy alias mapping to organization setter. */
  return setActiveOrganizationId(tenantId);
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
