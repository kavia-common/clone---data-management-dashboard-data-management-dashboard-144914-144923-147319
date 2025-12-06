//
// Tenant client utilities: normalize ids, manage active tenant in localStorage,
// and perform API calls related to tenant session management.
//
// This module intentionally avoids circular imports and effect-dispatch loops.
// All state updates are idempotent and guarded.
//
// Note: Keys used
// - 'activeOrganization' (preferred)
// - 'activeTenant' (legacy mirror)
// - 'activeTenantId' (legacy, cleaned up on writes)

// PUBLIC_INTERFACE
export function normalizeTenantId(input) {
  /** Normalize a tenant identifier from various shapes to a string id or null. */
  if (!input) return null;
  if (typeof input === 'string' || typeof input === 'number') return String(input);
  if (typeof input === 'object') {
    const { tenant_id, tenantId, id, _id } = input;
    return String(tenant_id ?? tenantId ?? id ?? _id ?? '') || null;
  }
  return null;
}

// PUBLIC_INTERFACE
export function getActiveTenant() {
  /** Returns the active tenant id (organization id) from localStorage; null if not set. */
  try {
    // Prefer the modern key; fall back to legacy keys.
    return (
      window.localStorage.getItem('activeOrganization') ||
      window.localStorage.getItem('activeTenant') ||
      window.localStorage.getItem('activeTenantId') ||
      null
    );
  } catch {
    return null;
  }
}

// PUBLIC_INTERFACE
export function setActiveTenant(tenantId) {
  /**
   * Persist the active tenant id across the preferred key and legacy keys.
   * Idempotent: no changes if already set to the same value.
   */
  const id = tenantId != null ? String(tenantId) : null;

  try {
    const current =
      window.localStorage.getItem('activeOrganization') ||
      window.localStorage.getItem('activeTenant') ||
      window.localStorage.getItem('activeTenantId') ||
      null;

    // Idempotent guard
    if (id && current === id) {
      // Ensure legacy cleanup if needed even when id matches
      try {
        window.localStorage.removeItem('activeTenantId');
      } catch {}
      return;
    }

    if (id) {
      window.localStorage.setItem('activeOrganization', id);
      window.localStorage.setItem('activeTenant', id); // legacy mirror
      // Remove oldest legacy key to avoid drift
      window.localStorage.removeItem('activeTenantId');
    } else {
      // Clear all keys when setting to nullish
      window.localStorage.removeItem('activeOrganization');
      window.localStorage.removeItem('activeTenant');
      window.localStorage.removeItem('activeTenantId');
    }
  } catch {
    // ignore storage errors
  }
}

// PUBLIC_INTERFACE
export function clearActiveTenant() {
  /**
   * Clears any active tenant selection from localStorage.
   * Guarded and idempotent: If nothing is set, it's a no-op.
   * Never dispatches or triggers re-entrant calls; pure storage operation.
   */
  try {
    const hadAny =
      !!window.localStorage.getItem('activeOrganization') ||
      !!window.localStorage.getItem('activeTenant') ||
      !!window.localStorage.getItem('activeTenantId');

    if (!hadAny) return; // idempotent no-op

    window.localStorage.removeItem('activeOrganization');
    window.localStorage.removeItem('activeTenant');
    window.localStorage.removeItem('activeTenantId');
  } catch {
    // ignore
  }
}

/**
 * PUBLIC_INTERFACE
 * fetchWithTenant
 * Wrapper around fetch that attaches x-organization-id header when available.
 * Accepts options.headers and does not override existing headers.
 * The third parameter may include { organization_id } for explicit scoping; when not provided,
 * it tries to use localStorage active tenant (activeOrganization/activeTenant).
 */
export async function fetchWithTenant(path, options = {}, { organization_id } = {}) {
  const url = path.startsWith('http') ? path : path; // CRA proxy handles /api/*
  const headers = {
    ...(options.headers || {}),
  };

  // Determine tenant id from explicit param or local storage keys
  let orgId = organization_id;
  if (!orgId) {
    try {
      orgId =
        window.localStorage.getItem('activeOrganization') ||
        window.localStorage.getItem('activeTenant') ||
        window.localStorage.getItem('activeTenantId') ||
        null;
    } catch {
      // ignore
    }
  }

  if (orgId && !headers['x-organization-id']) {
    headers['x-organization-id'] = String(orgId);
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: options.credentials || 'include',
  });
}

// INTERNAL: parse JSON response safely
async function parseJson(resp) {
  const ct = resp?.headers?.get?.('content-type') || '';
  if (ct.includes('application/json')) {
    return resp.json();
  }
  return null;
}

// PUBLIC_INTERFACE
export async function fetchSessionTenants() {
  /**
   * Fetch authorized tenants for the current user session.
   * Returns an array (empty if none) and does not modify localStorage by itself.
   */
  const resp = await fetchWithTenant('/api/session/tenants', { method: 'GET' });
  if (!resp?.ok) {
    return [];
  }
  const data = await parseJson(resp);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

// PUBLIC_INTERFACE
export async function selectTenant(tenantId, reason = 'user_selection') {
  /**
   * POST to set active tenant on the server; idempotent client-side persistence on success.
   * Validation: requires tenantId.
   */
  const id = normalizeTenantId(tenantId);
  if (!id) {
    throw new Error('tenantId is required');
  }

  const resp = await fetchWithTenant('/api/tenants/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantId: id, reason }),
  }, { organization_id: id });

  if (!resp?.ok) {
    const body = await parseJson(resp);
    const msg = body?.message || body?.error || `Failed to select tenant (${resp.status})`;
    throw new Error(msg);
  }

  // Persist locally in an idempotent way
  setActiveTenant(id);

  const json = await parseJson(resp);
  return json ?? { success: true };
}
