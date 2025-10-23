/**
 * Runtime-safe API base URL resolution utilities.
 * Prefers explicit environment variables, then computes from the current window location.
 * Falls back to relative "/api" which is proxied in development.
 */

function getEnv(name, def = "") {
  try {
    const v = process?.env?.[name];
    return typeof v === "string" && v.length > 0 ? v : def;
  } catch {
    return def;
  }
}

function isBrowser() {
  return typeof window !== "undefined" && !!window.location;
}

function safeJoin(base, path) {
  if (!base) return path || "";
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path ? (path.startsWith("/") ? path : `/${path}`) : "";
  return `${b}${p}`;
}

/**
 * Compute API config from env or the browser location.
 * - REACT_APP_API_URL takes precedence (full base, may include /api)
 * - REACT_APP_API_BASE_URL next (full base, may include /api)
 * - Otherwise compute from window: `${protocol}//${hostname}:${BACKEND_PORT}` + prefix
 * - Fallback to relative "/api" (works with CRA proxy)
 */
function computeApiConfig() {
  const explicitUrl =
    getEnv("REACT_APP_API_URL") || getEnv("REACT_APP_API_BASE_URL");
  const prefix = getEnv("REACT_APP_API_PREFIX", "/api");

  if (explicitUrl) {
    const base = explicitUrl; // could already include /api; do not double-append
    return {
      origin: (() => {
        try {
          const u = new URL(base);
          return `${u.protocol}//${u.host}`;
        } catch {
          return "";
        }
      })(),
      prefix: "",
      base,
      resolvedVia: "env",
    };
  }

  if (isBrowser()) {
    const proto = window.location.protocol;
    const host = window.location.hostname;

    // Prefer explicit backend port if provided, else default to 3001 for local/preview
    const backendPort = getEnv("REACT_APP_BACKEND_PORT", "3001");

    const origin = `${proto}//${host}:${backendPort}`;
    const base = safeJoin(origin, prefix);

    return {
      origin,
      prefix,
      base,
      resolvedVia: "window",
    };
  }

  // SSR / non-browser safe fallback (relative to current origin)
  return {
    origin: "",
    prefix,
    base: prefix || "/api",
    resolvedVia: "relative",
  };
}

const apiConfig = computeApiConfig();

// PUBLIC_INTERFACE
export function getApiBase() {
  /**
   * Returns the fully qualified API base URL to be used by HTTP clients.
   * Example: "http://localhost:3001/api" or "https://<preview-host>:3001/api"
   */
  return apiConfig.base;
}

// PUBLIC_INTERFACE
export function getHealthUrl() {
  /**
   * Returns the base server health URL for GET "/".
   * Example: "http://localhost:3001/" or "https://<preview-host>:3001/"
   */
  const origin = apiConfig.origin;
  if (origin) return `${origin}/`;
  // If we don't know origin (SSR), default to "/openapi.json" which is proxied
  return "/openapi.json";
}

export default { getApiBase, getHealthUrl };
