const apiBase =

  // `https://kavia-dashboard-kavia-dev.cloud.kavia.ai/api`;
  'https://vscode-internal-25365-beta.beta01.cloud.kavia.ai:3001/api'

/**
 * PUBLIC_INTERFACE
 * getApiBase
 * Returns the base URL for backend API requests, preferring REACT_APP_API_BASE_URL
 * and falling back to current host with port 3001.
 */
export function getApiBase() {
  return apiBase;
}

export default { getApiBase };