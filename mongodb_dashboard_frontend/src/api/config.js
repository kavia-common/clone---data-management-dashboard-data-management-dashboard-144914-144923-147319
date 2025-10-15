const apiBase =
  process.env.REACT_APP_API_BASE_URL ||
  `${window.location.protocol}//${window.location.hostname}:7001/api`;

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests, preferring REACT_APP_API_BASE_URL
 * and falling back to current host with port 7001.
 */
export function getApiBase() {
  return apiBase;
}

export default { getApiBase };
