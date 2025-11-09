import { getApiBaseUrl } from "./util";

/**
 * PUBLIC_INTERFACE (Deprecated)
 * getApiBase
 * Deprecated shim to preserve older imports. Delegates to getApiBaseUrl().
 * Returns a base that includes '/api' suffix.
 */
export function getApiBase() {
  return getApiBaseUrl();
}
