/**
 * PUBLIC_INTERFACE
 * Utility helpers for API layer (reverted).
 * Currently empty; retained for backward compatibility if imported elsewhere.
 */
export function getApiBaseUrl() {
  const base = process.env.REACT_APP_API_BASE_URL || '';
  return `${base}`.replace(/\/*$/, '');
}
