/**
 * Central API config that resolves the backend base URL.
 * Delegates to util.getApiBaseUrl() for consistent env-based resolution.
 */
import { getApiBaseUrl } from "./util";

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests.
 * Priority:
 * - REACT_APP_API_BASE_URL or REACT_APP_API_URL (build-time env)
 * - In development: '/api' so CRA setupProxy can forward to backend
 * - Fallback to http://localhost:3001/api if window is not available
 */
export function getApiBase() {
  return getApiBaseUrl();
}

export default { getApiBase };
