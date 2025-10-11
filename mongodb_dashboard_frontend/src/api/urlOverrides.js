 /**
  * URL override helper for specific endpoints.
  * We special-case only selected auth endpoints to always call the external domain.
  * As of now, these are:
  *   - /api/auth/user-organizations
  *   - /api/auth/login
  * All other endpoints should continue to use existing base URL logic.
  *
  * To add more overrides later:
  *   - Add a new RegExp to the OVERRIDES list below that uniquely matches the path to be forced external.
  *   - Keep patterns specific to avoid accidental routing changes.
  */

// PUBLIC_INTERFACE
export function resolveAuthEndpointUrl(path, baseUrl) {
  /** Resolve a full URL for auth endpoints.
   * Special-cased to force the absolute external domain for:
   *   - GET /api/auth/user-organizations?... (organization discovery)
   *   - POST /api/auth/login (login must hit external)
   * Everything else should continue to use the provided baseUrl.
   *
   * Rationale: Certain auth flows must bypass local/proxied base URLs to ensure
   * cross-environment consistency while allowing the rest of the app to use the
   * existing base URL logic.
   */

  // Normalize input
  const safeBase = String(baseUrl || '').replace(/\/+$/, '');
  const safePath = String(path || '');

  // Define explicit override patterns that must route to the external domain.
  // Important: make patterns strict and anchored to avoid over-matching.
  const OVERRIDES = [
    // /api/auth/user-organizations (GET with optional query)
    /\/api\/auth\/user-organizations(?:\/)?(\?|$)/,
    // /api/auth/login (POST; may include trailing slash or query in future)
    /\/api\/auth\/login(?:\/)?(\?|$)/,
  ];

  const shouldForceExternal = OVERRIDES.some((re) => re.test(safePath));
  if (shouldForceExternal) {
    // Absolute external domain per requirement
    const ABS_EXTERNAL_BASE = 'https://kaviaqa-worktool.cloud.kavia.ai';
    // Do not assume leading/trailing slashes; join carefully
    const finalPath = safePath.startsWith('/') ? safePath : `/${safePath}`;
    return `${ABS_EXTERNAL_BASE}${finalPath}`;
  }

  // Default: join with provided base URL
  if (!safePath) return safeBase;
  const joinedPath = safePath.startsWith('/') ? safePath : `/${safePath}`;
  return `${safeBase}${joinedPath}`;
}
