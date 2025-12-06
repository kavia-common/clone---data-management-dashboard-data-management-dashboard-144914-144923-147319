import { buildAuthHeaders, getOrganizationId } from '../api/authTokenProvider';
import { getApiBase, joinUrl } from '../api/config';

/**
 * PUBLIC_INTERFACE
 * apiGet (JS wrapper)
 * Centralized GET helper that automatically injects Authorization and appends organization_id when available.
 * Ensures exactly one '/api' is present in final URL.
 */
function isAbsoluteUrl(url) {
  return /^https?:\/\//i.test(url);
}

/**
 * Ensure exactly one '/api' in final URL:
 * - If url starts with '/api', join with base root (strip trailing '/api' if present).
 * - If url is relative and doesn't start with '/api', prepend '/api' relative to base.
 */
function normalizeUrl(url) {
  const base = getApiBase();
  const baseRoot = String(base || '').replace(/\/+$/, '');
  if (isAbsoluteUrl(url)) return url;

  if (url.startsWith('/api')) {
    const root = /\/api$/i.test(baseRoot) ? baseRoot.replace(/\/api$/i, '') : baseRoot;
    return joinUrl(root, url);
  }
  const apiBase = /\/api$/i.test(baseRoot) ? baseRoot : `${baseRoot}/api`;
  const rel = url.startsWith('/') ? url : `/${url}`;
  return joinUrl(apiBase, rel);
}

// PUBLIC_INTERFACE
export async function apiGet(url, options = {}) {
  const finalUrl = normalizeUrl(url);

  const headers = buildAuthHeaders({
    Accept: 'application/json',
    ...(options.headers || {}),
  });

  // Append organization_id query if not present (some endpoints require it)
  let effUrl = finalUrl;
  const orgId = getOrganizationId();
  if (orgId && !/[?&]organization_id=/.test(finalUrl)) {
    const sep = finalUrl.includes('?') ? '&' : '?';
    effUrl = `${finalUrl}${sep}organization_id=${encodeURIComponent(orgId)}`;
  }

  const res = await fetch(effUrl, {
    method: 'GET',
    headers,
    signal: options.signal,
  });

  let payload = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  } else {
    try {
      payload = await res.text();
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && (payload.message || payload.detail)) ||
      (typeof payload === 'string' ? payload : `Request failed (${res.status})`);
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  return payload;
}

export default { apiGet };
