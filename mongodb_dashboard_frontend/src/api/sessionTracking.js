import { getApiBase } from './config';
import { sanitizeRequestParams } from './requestSanitizer';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * GET /api/session-tracking with query params.
 * Accepts both envelope and raw array responses; returns a normalized object { items, meta? }.
 */
export async function getSessionTracking(params = {}, options = {}) {
  const base = getApiBase?.() || '';
  const url = new URL('/api/session-tracking', base);
  const sanitized = sanitizeRequestParams ? sanitizeRequestParams(params) : params;

  Object.entries(sanitized || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  });

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    credentials: 'include',
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
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
