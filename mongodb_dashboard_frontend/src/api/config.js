/**
 * Centralized API base URL and helpers.
 * Normalization rules:
 * - If request paths start with '/api', we should use a base URL WITHOUT trailing '/api' (root only).
 * - If request paths are relative like '/users' (no '/api' prefix), then base should include '/api'.
 * We expose getApiBase() which returns a base suitable for our clients that accept both styles:
 *   - If you pass a path starting with '/api', client must not prepend '/api'.
 *   - If you pass a path without '/api', client will prepend '/api'.
 */

// Read base from environment with multiple fallbacks
function readRawBase() {
  const envs = [
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) || '',
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_BACKEND_URL) || '',
    (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE) || '',
  ];
  // First non-empty trimmed
  const v = envs.find((x) => x && String(x).trim().length > 0);
  if (v) return String(v).trim();
  // Default to same-host backend under /api
  return '/api';
}

/**
 * Remove duplicate slashes (except protocol), e.g., 'http://a//b' -> 'http://a/b'
 */
export function joinUrl(...parts) {
  const joined = parts
    .filter(Boolean)
    .map((p) => String(p))
    .join('/');
  // Preserve protocol double-slash
  return joined
    .replace(/([^:]\/)\/+/g, '$1')
    .replace(/\/+\?/g, '?')
    .replace(/\/+#/g, '#');
}

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Return a normalized base URL that client.js/baseClient.js can use safely.
 * - If env already ends with '/api', we return it (clients handle '/api' or non '/api' paths)
 * - If env is a bare host/root without '/api', return it without adding '/api'
 * Clients will join correctly based on whether the provided path starts with '/api'.
 */
export function getApiBase() {
  const raw = readRawBase();
  // If it's relative '/api' only, keep as-is
  if (raw === '/api') return '/api';
  // Normalize trailing slash once
  const noTrail = raw.replace(/\/+$/, '');
  return noTrail;
}

// Default export as an object to match existing import style in the codebase
const config = {
  getApiBase,
};

export default config;