//
// Generic API client for the frontend
// - Reads base URL from REACT_APP_API_BASE_URL or defaults to '/api'
// - Exposes a simple apiGet helper that returns parsed JSON with basic error handling
//

/**
 * Resolve the API base URL from environment or default.
 * We avoid hard-coding service URLs to support multiple environments.
 */
const API_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) ||
  '/api';

/**
 * Build a full URL for an endpoint. Handles cases where path already begins with '/api'.
 * @param {string} path - Endpoint path, e.g. '/users' or 'users'
 * @returns {string} - Full absolute or relative URL
 */
function buildUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  // If API_BASE_URL already ends with '/', avoid double slash
  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${base}${normalizedPath}`;
}

/**
 * PUBLIC_INTERFACE
 * Perform a GET request and return parsed JSON.
 * This is a thin wrapper over fetch with simple error handling.
 * @param {string} path - Relative API path beginning with '/' or without (e.g. '/users' or 'users')
 * @param {RequestInit} [options] - Optional fetch options (headers, etc.)
 * @returns {Promise<any>} - Parsed JSON response
 */
export async function apiGet(path, options = {}) {
  /** This is a public function. */
  const url = buildUrl(path);
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      method: 'GET',
    });
  } catch (networkError) {
    // Network-level error (DNS, connection refused, etc.)
    const err = new Error(`Network error while GET ${url}: ${networkError?.message || networkError}`);
    err.cause = networkError;
    err.status = 0;
    throw err;
  }

  // Attempt to parse response
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      // Non-JSON responses
      const err = new Error(`Failed to parse JSON from ${url}: ${parseErr?.message || parseErr}`);
      err.cause = parseErr;
      err.status = res.status;
      err.rawBody = text;
      if (!res.ok) {
        // If server reported error status, throw with context
        throw err;
      }
      // For ok responses with non-JSON, just return raw text
      return text;
    }
  }

  if (!res.ok) {
    const err = new Error(`GET ${url} failed with status ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible API client factory to avoid breaking existing imports.
 * Returns an object exposing apiBaseUrl, buildUrl, and helper methods like get.
 * Example usage in legacy code:
 *   const api = getApiClient();
 *   const data = await api.get('/users');
 */
export function getApiClient() {
  /** This is a public function. */
  return {
    apiBaseUrl: API_BASE_URL,
    buildUrl,
    get: apiGet,
  };
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible export stub for legacy imports that expected listUsers from client.js.
 * Modern code should import from './users' or use apiGet directly.
 * We keep this here to avoid build failures; it calls the proper users API if present.
 */
export async function listUsers(params = {}) {
  /** This is a public function. */
  // Construct query string from params
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const path = `/users${qs.toString() ? `?${qs.toString()}` : ''}`;
  return apiGet(path);
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible export stub for legacy imports that expected listDeployments from client.js.
 * Delegates to GET /app-deployments with optional query params.
 */
export async function listDeployments(params = {}) {
  /** This is a public function. */
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const path = `/app-deployments${qs.toString() ? `?${qs.toString()}` : ''}`;
  return apiGet(path);
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible export stub for legacy imports that expected listSessions from client.js.
 * Delegates to GET /session-tracking with optional query params.
 */
export async function listSessions(params = {}) {
  /** This is a public function. */
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const path = `/session-tracking${qs.toString() ? `?${qs.toString()}` : ''}`;
  return apiGet(path);
}

/**
 * PUBLIC_INTERFACE
 * Backward-compatible export stub for legacy imports that expected listLlmCosts from client.js.
 * Delegates to GET /llm-costs with optional query params.
 */
export async function listLlmCosts(params = {}) {
  /** This is a public function. */
  const qs = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
  });
  const path = `/llm-costs${qs.toString() ? `?${qs.toString()}` : ''}`;
  return apiGet(path);
}

export { API_BASE_URL };
