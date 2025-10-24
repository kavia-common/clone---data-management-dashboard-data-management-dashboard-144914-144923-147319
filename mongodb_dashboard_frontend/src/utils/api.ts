//
// PUBLIC_INTERFACE
// apiGet
// Lightweight GET wrapper using fetch with JSON parsing, HTTP error handling, and optional base URL.
//
// Notes:
// - Respects REACT_APP_API_BASE_URL when provided.
// - Accepts either absolute URLs (http/https), /api-prefixed relative URLs, or other relative paths.
// - Returns parsed JSON on success; throws Error on non-2xx with best-effort message.
//
// Usage:
//   const data = await apiGet('/api/analytics/llm-cost-by-agent');
//   const data = await apiGet('https://example.com/api/data');
//

type ApiGetOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  // Add passthrough options here in the future (e.g., credentials)
};

function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function joinUrl(base: string, path: string): string {
  if (!base) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  if (!path) return b;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/**
 * PUBLIC_INTERFACE
 * apiGet
 * Performs a GET request and returns parsed JSON or throws on HTTP errors.
 */
export async function apiGet<T = any>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const base = (typeof process !== 'undefined' && process.env && (process.env as any).REACT_APP_API_BASE_URL) || '';
  // Determine final URL
  const finalUrl = isAbsoluteUrl(url)
    ? url
    : url.startsWith('/api')
      ? url // allow CRA proxy to handle /api
      : joinUrl(base, url);

  const res = await fetch(finalUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    signal: options.signal,
    // credentials are not included by default; add when required for session-based APIs
  });

  let payload: any = null;

  // Attempt to parse JSON regardless of status to get error details
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
    // Build best-effort message
    const message =
      (payload && typeof payload === 'object' && (payload.message || payload.detail)) ||
      (typeof payload === 'string' ? payload : `Request failed (${res.status})`);
    const err = new Error(message);
    (err as any).status = res.status;
    (err as any).payload = payload;
    throw err;
  }

  // If payload is string (unexpected), return as-is; else object/array
  return payload as T;
}

export default {
  apiGet,
};
