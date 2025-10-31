const apiBase =
  
  `https://kavia-dashboard-kavia-dev.cloud.kavia.ai/api`;

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests.
 * Using static backend URL for all environments.
 */
export function getApiBase() {
  return apiBase;
}

export default { getApiBase };
