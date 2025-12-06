/**
 * Centralized API base URL resolution for frontend API calls.
 * Priority:
 * 1) REACT_APP_API_BASE_URL (absolute, e.g., https://backend.example.com/api)
 * 2) REACT_APP_API_PREFIX (path prefix, e.g., /api) combined with current origin
 * 3) Fallback to relative '/api'
 *
 * This avoids localhost assumptions and works in preview environments where the
 * frontend and backend are on the same host with different ports behind a proxy.
 */

// Resolve from env (build-time)
const ENV_BASE = process.env.REACT_APP_API_BASE_URL && String(process.env.REACT_APP_API_BASE_URL).trim();
const ENV_PREFIX = process.env.REACT_APP_API_PREFIX && String(process.env.REACT_APP_API_PREFIX).trim();

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests as a string.
 * - If ENV_BASE is absolute, return it (without trailing slash).
 * - Else if ENV_PREFIX provided, prefer that as a path (ensuring it starts with '/').
 * - Else default to '/api'.
 */
export function getApiBase() {
  if (ENV_BASE) {
    return ENV_BASE.replace(/\/+$/, '');
  }
  if (ENV_PREFIX) {
    const prefix = ENV_PREFIX.startsWith('/') ? ENV_PREFIX : `/${ENV_PREFIX}`;
    return prefix.replace(/\/+$/, '');
  }
  // Default: relative path that will be proxied/same-site to backend
  return '/api';
}

// PUBLIC_INTERFACE
export const apiBase = getApiBase();

// Default export as an object to match existing import style in the codebase
const config = {
  apiBase,
  getApiBase,
};

export default config;
