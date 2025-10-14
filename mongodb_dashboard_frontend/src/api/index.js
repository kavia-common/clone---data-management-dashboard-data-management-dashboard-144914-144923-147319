//
// PUBLIC_INTERFACE
/**
 * Resolve the API base URL for the frontend.
 * Order of precedence:
 * 1) REACT_APP_API_URL (full base, e.g., http://localhost:3001/api)
 * 2) REACT_APP_API_BASE_URL (+ optional REACT_APP_API_PREFIX, default "/api")
 * 3) Derived from window.location: same host with backend port (REACT_APP_BACKEND_PORT or 3001) + prefix
 *
 * Notes:
 * - Trailing slashes are trimmed to avoid double slashes.
 * - In development, logs the resolved values for debugging Network Error issues.
 */
export function resolveApiBaseUrl() {
  const rawUrl = process.env.REACT_APP_API_URL?.trim();
  const rawBase = process.env.REACT_APP_API_BASE_URL?.trim();
  const rawPrefix = (process.env.REACT_APP_API_PREFIX ?? "/api").trim() || "/api";
  const backendPort = parseInt(process.env.REACT_APP_BACKEND_PORT || "3001", 10);

  const sanitize = (s) => (s || "").replace(/\/+$/, "");
  const ensureSlash = (s) => (s?.startsWith("/") ? s : `/${s || ""}`);

  if (rawUrl) {
    const resolved = sanitize(rawUrl);
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[API] baseURL: ${resolved} (preferred=REACT_APP_API_URL)`);
    }
    return resolved;
  }

  if (rawBase) {
    const base = sanitize(rawBase);
    const prefix = ensureSlash(rawPrefix);
    const resolved = `${base}${prefix}`;
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[API] baseURL: ${resolved} (RAW: ${rawBase} PREFIX: ${rawPrefix})`);
    }
    return resolved;
  }

  // Fallback: infer from window location
  try {
    const url = new URL(window.location.href);
    const inferredBase = `${url.protocol}//${url.hostname}:${backendPort}`;
    const resolved = `${inferredBase}${ensureSlash(rawPrefix)}`;
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(
        `[API] baseURL: ${resolved} (inferred from window: ${url.hostname}, port=${backendPort}, prefix=${rawPrefix})`
      );
    }
    return resolved;
  } catch {
    const resolved = `http://localhost:${backendPort}${ensureSlash(rawPrefix)}`;
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log(`[API] baseURL: ${resolved} (fallback localhost)`);
    }
    return resolved;
  }
}
