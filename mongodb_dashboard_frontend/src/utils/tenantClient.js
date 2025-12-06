/* Existing utility file preserved; adding fetchWithTenant wrapper for API calls that need tenant scoping header. */

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

// Re-export commonly used helpers for compatibility with existing imports
export { getActiveTenant, setActiveTenant, clearActiveTenant } from './tenantClient';
