export function buildQueryString(params = {}) {
  // PUBLIC_INTERFACE
  /** Builds query string beginning with '?' or returns empty string when no params. */
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  const usp = new URLSearchParams();
  for (const [k, v] of entries) {
    usp.append(k, String(v));
  }
  return `?${usp.toString()}`;
}

/**
 * PUBLIC_INTERFACE
 * getApiBaseUrl
 * Resolver returning the API base URL string.
 * Priority:
 * - REACT_APP_API_BASE_URL or REACT_APP_API_URL env var if present (injected at build time)
 * - In development: '/api' so CRA setupProxy can forward to backend
 * - Otherwise: window.location-based heuristic to port 3001, or localhost fallback
 */
export function getApiBaseUrl() {
  // Prefer explicit env variables injected at build time
  const env =
    process.env.REACT_APP_API_BASE_URL ||
    process.env.REACT_APP_API_URL;

  if (env && typeof env === "string" && env.trim()) {
    return String(env).replace(/\/*$/, "");
  }

  // In development, prefer relative '/api' so setupProxy handles target routing.
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "development") {
    return "/api";
  }

  // Otherwise, construct from current window location or fallback to localhost.
  try {
    const url = new URL(window.location.href);
    return `${url.protocol}//${url.hostname}:3001/api`;
  } catch {
    // Fallback for non-browser contexts
    return "http://localhost:3001/api";
  }
}
