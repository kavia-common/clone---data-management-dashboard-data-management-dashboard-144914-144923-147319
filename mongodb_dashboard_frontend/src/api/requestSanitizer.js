'use strict';

// PUBLIC_INTERFACE
/**
 * sanitizeRequestInit
 * Omits tenant/organization scoping for Super Admin (including T0000 case) from:
 * - headers: x-organization-id, x-tenant-id, x-tenant, organization_id
 * - body: strips organization_id/tenant_id and their aliases
 * Also sets x-all-tenants: true header when global mode is active.
 *
 * Usage: wrap fetch init before sending.
 */
export function sanitizeRequestInit(init = {}, { isSuperAdmin = false, allTenants = false } = {}) {
  const safeInit = { ...(init || {}) };
  // Normalize headers to a plain object we can mutate
  const headersIn = safeInit.headers || {};
  const normalizedHeaders =
    headersIn instanceof Headers
      ? Object.fromEntries(headersIn.entries())
      : { ...headersIn };

  function stripTenantHeaders(h) {
    delete h['x-organization-id'];
    delete h['x-org-id'];
    delete h['x-tenant-id'];
    delete h['x-tenant'];
    delete h['organization_id'];
    delete h['tenant_id'];
    return h;
  }

  if (isSuperAdmin && (allTenants === true)) {
    stripTenantHeaders(normalizedHeaders);
    normalizedHeaders['x-all-tenants'] = 'true';
  }

  // Sanitize JSON body if present
  if (safeInit.body && typeof safeInit.body === 'string') {
    try {
      const parsed = JSON.parse(safeInit.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        delete parsed.tenant_id;
        delete parsed.tenantId;
        delete parsed.organization_id;
        delete parsed.organizationId;
        delete parsed.orgId;
        // If SA global, do not stamp any tenant back
        safeInit.body = JSON.stringify(parsed);
      }
    } catch {
      // not JSON - ignore
    }
  }

  safeInit.headers = normalizedHeaders;
  return safeInit;
}

// PUBLIC_INTERFACE
/**
 * sanitizeUrl
 * Removes tenant_id/organization_id query parameters from url for Super Admin when in allTenants mode.
 */
export function sanitizeUrl(url, { isSuperAdmin = false, allTenants = false } = {}) {
  if (!isSuperAdmin || !allTenants) return url;
  try {
    const u = new URL(url, window.location.origin);
    u.searchParams.delete('tenant_id');
    u.searchParams.delete('organization_id');
    return u.toString();
  } catch {
    // Fallback: crude stripping
    return url
      .replace(/([?&])tenant_id=[^&#]*/gi, '$1')
      .replace(/([?&])organization_id=[^&#]*/gi, '$1')
      .replace(/[?&](&|#|$)/, '$1');
  }
}

// PUBLIC_INTERFACE
/**
 * isT0000Like - detect special "all tenants" org id selection from UI.
 */
export function isT0000Like(val) {
  if (!val) return false;
  return /^T0+$/i.test(String(val).trim());
}
