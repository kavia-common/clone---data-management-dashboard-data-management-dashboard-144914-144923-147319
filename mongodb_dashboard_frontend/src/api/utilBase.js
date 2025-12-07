export function getApiBase() {
  // Try various envs used in this project
  const envCandidates = [
    process.env.REACT_APP_BACKEND_URL,
    process.env.REACT_APP_API_BASE_URL,
    process.env.REACT_APP_API_BASE,
    process.env.REACT_APP_FRONTEND_URL, // fallback (proxy)
  ];
  const base = envCandidates.find(Boolean) || '';
  // When using CRA proxy, relative base is fine
  return base || '';
}
