 /**
  * URL override helper for specific endpoints.
  * We special-case only the "user-organizations" endpoint to always call the external domain.
  * All other endpoints should continue to use existing base URL logic.
  */

// PUBLIC_INTERFACE
export function resolveAuthEndpointUrl(path, baseUrl) {
  /** Resolve a full URL for auth endpoints.
   * Special-case: GET /api/auth/user-organizations?... MUST use the absolute external domain.
   * Everything else should continue to use the provided baseUrl.
   *
   * This is done to ensure organization lookup works across environments while
   * keeping other API calls local/proxied. Do not generalize this unless explicitly required.
   */

  // Normalize input
  const safeBase = String(baseUrl || '').replace(/\/+$/, '');
  const safePath = String(path || '');

  // If path targets the user-organizations endpoint, force absolute external URL
  // Accepted forms:
  // - /api/auth/user-organizations
  // - api/auth/user-organizations
  // - /auth/user-organizations (will be normalized to /api/auth/user-organizations by callers ideally)
  const targetPattern = /\/api\/auth\/user-organizations(?:\/)?(\?|$)/;

  if (targetPattern.test(safePath)) {
    // Absolute external domain per requirement
    const ABS_ORG_URL_BASE = 'https://kaviaqa-worktool.cloud.kavia.ai';
    // Do not assume trailing slash in path; join carefully
    const hasLeadingSlash = safePath.startsWith('/');
    const finalPath = hasLeadingSlash ? safePath : `/${safePath}`;
    return `${ABS_ORG_URL_BASE}${finalPath}`;
  }

  // Default: join with provided base URL
  if (!safePath) return safeBase;
  const joinedPath = safePath.startsWith('/') ? safePath : `/${safePath}`;
  return `${safeBase}${joinedPath}`;
}
