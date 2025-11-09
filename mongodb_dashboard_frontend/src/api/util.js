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
 * Backward-compatible resolver returning the API base URL string.
 * Priority:
 * - REACT_APP_API_BASE_URL env var if present (injected at build time)
 * - window.location-based heuristic pointing to port 3001
 */
export function getApiBaseUrl() {
  const env = process.env.REACT_APP_API_BASE_URL;
  if (env && typeof env === "string" && env.trim()) {
    return env.replace(/\/+$/, "");
  }
  try {
    const url = new URL(window.location.href);
    return `${url.protocol}//${url.hostname}:3001/api`;
  } catch {
    // Fallback for non-browser contexts
    return "http://localhost:3001/api";
  }
}