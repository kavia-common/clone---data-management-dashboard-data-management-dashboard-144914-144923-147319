import { getApiBase } from './config';
import { sanitizeRequestParams } from './requestSanitizer';
import { getActiveTenant } from '../utils/tenantClient';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * GET /api/session-tracking with query params.
 * Accepts both envelope and raw array responses; returns a normalized object { items, meta? }.
 *
 * Conventions:
 * - Use query params only (no JSON body on GET).
 * - tenant scope: prefer explicit tenant_id/organization_id query when provided; otherwise attach x-organization-id header
 *   from localStorage (active tenant) for backend scoping consistency with other modules.
 * - Pagination defaults: page=1 when page provided without a value; limit optional (caller can pass).
 */
export async function getSessionTracking(params = {}, options = {}) {
  const base = getApiBase?.() || '';
  const url = new URL('/api/session-tracking', base);

  // Normalize and sanitize params
  const input = { ...(params || {}) };

  // Align tenant parameter naming: if only tenant_id provided, also mirror organization_id (and vice versa)
  const explicitTenant = input.tenant_id || input.organization_id || input.tenantId || input.organizationId;
  if (explicitTenant) {
    input.tenant_id = String(explicitTenant);
    input.organization_id = String(explicitTenant);
    delete input.tenantId;
    delete input.organizationId;
  }

  // Normalize page alias and defaults: backend supports page/limit
  if (input.pageSize && !input.limit) {
    input.limit = input.pageSize;
    delete input.pageSize;
  }
  if (input.page === undefined && input.limit !== undefined) {
    // if limit provided but page not, leave as is (backend returns envelope only when page present)
  } else if (input.page === undefined && input.limit === undefined) {
    // default to raw array (no pagination) unless caller set these
  }

  // Normalize time window: accept from/to only (backend for session-tracking does not specify granularity)
  // If rangeType/custom provided elsewhere, they should have been converted before reaching here.
  // We keep granularity if provided by caller for potential server hints but it's not required.
  const sanitized = sanitizeRequestParams ? sanitizeRequestParams(input) : input;

  Object.entries(sanitized || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  // Build headers without forcing Content-Type for GET
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  // Attach x-organization-id from active tenant when explicit query not set
  const hasTenantInQuery =
    url.searchParams.has('organization_id') || url.searchParams.has('tenant_id');
  if (!hasTenantInQuery) {
    const active = getActiveTenant?.();
    if (active && !headers['x-organization-id']) {
      headers['x-organization-id'] = String(active);
    }
  } else {
    // Mirror header from query if not already set (helps some backend flows)
    const qTenant = url.searchParams.get('organization_id') || url.searchParams.get('tenant_id');
    if (qTenant && !headers['x-organization-id']) {
      headers['x-organization-id'] = String(qTenant);
    }
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers,
    credentials: 'include',
    signal: options.signal,
  });

  if (!res.ok) {
    // Defensive logging for visibility in dev
    const text = await res.text().catch(() => '');
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(
        '[sessionTracking] GET /api/session-tracking failed',
        res.status,
        text || res.statusText,
        'URL:',
        url.toString()
      );
    }
    const error = new Error(`Session tracking request failed (${res.status}): ${text || res.statusText}`);
    error.status = res.status;
    error.body = text;
    throw error;
  }

  const contentType = res.headers.get('content-type') || '';
  let json;
  if (contentType.includes('application/json')) {
    json = await res.json();
  } else {
    try {
      json = await res.json();
    } catch {
      json = null;
    }
  }

  if (Array.isArray(json)) {
    return { items: json, meta: null };
  }
  if (json && typeof json === 'object') {
    // Support various shapes: { data, meta } or { items, total }
    if (Array.isArray(json.data)) {
      return { items: json.data, meta: json.meta || null };
    }
    if (Array.isArray(json.items)) {
      return { items: json.items, meta: json.meta || null };
    }
  }
  return { items: [], meta: null };
}

/**
 * PUBLIC_INTERFACE
 * fetchSessionTracking
 * Thin alias to match other modules' import style.
 */
export async function fetchSessionTracking(params = {}, options = {}) {
  return getSessionTracking(params, options);
}

export default {
  getSessionTracking,
  fetchSessionTracking,
};
