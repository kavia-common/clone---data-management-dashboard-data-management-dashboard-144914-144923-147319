//
// ============================================================================
// REQUIREMENT TRACEABILITY
// ============================================================================
// Requirement ID: REQ-FE-TENANT-ROUTING-001
// User Story: As an authenticated user, I want to select my tenant after login so the app scopes data correctly.
// Acceptance Criteria:
// - GET /api/session/tenants used to fetch authorized tenants
// - POST /api/tenants/select to set active tenant (cookie-based), optionally mirror in localStorage
// - Consistent localStorage key usage ('activeTenant'), with backward compatibility for legacy 'activeTenantId'
// - Provide small JS helpers and inline docs
// GxP Impact: NO - Frontend routing utility only (no persistent data change)
// Risk Level: LOW
// Validation Protocol: VP-FE-TENANT-ROUTING
// ============================================================================
//
// ============================================================================
// IMPORTS AND DEPENDENCIES
// ============================================================================
// None (uses fetch)
// ============================================================================

/**
 * PUBLIC_INTERFACE
 * normalizeTenantId
 * Extracts a tenant id from a variety of structures.
 * @param {any} t - tenant-like value
 * @returns {string|null} normalized id or null
 */
export function normalizeTenantId(t) {
  if (!t) return null;
  const id =
    t.tenant_id ||
    t.tenantId ||
    t.id ||
    t._id ||
    (typeof t === 'string' ? t : null);
  return id ? String(id) : null;
}

/**
 * PUBLIC_INTERFACE
 * getActiveTenant
 * Returns active tenant from localStorage. Prefers 'activeTenant' (new),
 * falls back to legacy 'activeTenantId' for backward compatibility.
 * @returns {string|null}
 */
export function getActiveTenant() {
  try {
    const v = window.localStorage.getItem('activeTenant');
    if (v) return v;
    // backward compatibility
    const legacy = window.localStorage.getItem('activeTenantId');
    return legacy || null;
  } catch {
    return null;
  }
}

/**
 * PUBLIC_INTERFACE
 * setActiveTenant
 * Sets/removes active tenant to 'activeTenant' key (and cleans up legacy key).
 * @param {string|null} tenantId
 * @returns {void}
 */
export function setActiveTenant(tenantId) {
  try {
    if (tenantId) {
      window.localStorage.setItem('activeTenant', String(tenantId));
    } else {
      window.localStorage.removeItem('activeTenant');
    }
    // clean legacy key to enforce consistency
    window.localStorage.removeItem('activeTenantId');
  } catch {
    // no-op
  }
}

/**
 * PUBLIC_INTERFACE
 * clearActiveTenant
 * Removes the active tenant client-side marker.
 */
export function clearActiveTenant() {
  setActiveTenant(null);
}

/**
 * PUBLIC_INTERFACE
 * fetchSessionTenants
 * Fetches authorized tenants for current authenticated user.
 * Uses credentials: 'include' to carry cookies via CRA proxy.
 * @returns {Promise<Array>} tenants array
 * @throws Error with status and message on non-OK
 */
export async function fetchSessionTenants() {
  let res;
  try {
    res = await fetch('/api/session/tenants', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
  } catch (e) {
    const err = new Error(`Network error while fetching tenants: ${e?.message || e}`);
    err.cause = e;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Failed to fetch tenants: ${res.status} ${text}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => []);
  // Prefer array; if envelope or object with items, normalize
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

/**
 * PUBLIC_INTERFACE
 * selectTenant
 * Sets active tenant via backend POST (cookie-based) and mirrors localStorage.
 * @param {string} tenantId - required
 * @param {string} [reason='user-selection'] - optional reason for audit trail
 * @returns {Promise<any>} response json or text
 * @throws Error with status on non-OK
 *
 * Validation:
 * - tenantId must be a non-empty string
 *
 * Audit:
 * - Logs client-side action to console in dev for traceability (user action)
 */
export async function selectTenant(tenantId, reason = 'user-selection') {
  if (!tenantId || typeof tenantId !== 'string') {
    const err = new Error('tenantId is required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[Tenant] Selecting tenant', { tenantId, reason, at: new Date().toISOString() });
  }

  let res;
  try {
    res = await fetch('/api/tenants/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' },
      body: JSON.stringify({ tenantId, reason }),
      credentials: 'include',
    });
  } catch (e) {
    const err = new Error(`Network error while selecting tenant: ${e?.message || e}`);
    err.cause = e;
    throw err;
  }

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => '');

  if (!res.ok) {
    const err = new Error(
      typeof payload === 'string'
        ? payload
        : payload?.message || `Failed to select tenant (${res.status})`
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  // Mirror client-side state for UI hints
  setActiveTenant(tenantId);
  try {
    // Keep new organization storage key in sync for unified reads
    window.localStorage.setItem('activeOrganization', String(tenantId));
  } catch {
    // ignore
  }
  return payload;
}
