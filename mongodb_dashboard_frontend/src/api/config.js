/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests.
 * - If REACT_APP_API_BASE_URL is set, uses it.
 * - Otherwise defaults to "/api" so CRA dev proxy can handle it and production can serve same-origin "/api".
 */
export function getApiBase() {
  const envBase = process.env.REACT_APP_API_BASE_URL || process.env.REACT_APP_API_BASE;
  if (envBase) return String(envBase).replace(/\/+$/, "") + "/api";
  // Default to relative /api for proxy/same-origin
  return "/api";
}

export default { getApiBase };
