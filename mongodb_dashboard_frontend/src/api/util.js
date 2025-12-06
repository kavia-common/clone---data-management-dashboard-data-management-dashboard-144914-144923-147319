import { getApiBase } from './config';

// PUBLIC_INTERFACE
export function buildQueryString(params = {}) {
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
 * Delegates to getApiBase() which respects env vars and falls back to relative '/api'.
 */
export function getApiBaseUrl() {
  return getApiBase();
}
