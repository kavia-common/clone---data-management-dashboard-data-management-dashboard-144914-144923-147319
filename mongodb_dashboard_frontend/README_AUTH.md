# Auth and Tenant Token Handling

This frontend uses a centralized token provider at src/api/authTokenProvider.js to:
- Read the JWT set after login (localStorage key "auth")
- Read and set active tenant_id (localStorage key "activeTenant")
- Build Authorization and X-Tenant-Id headers for all API requests

How it works:
- AuthContext.login now accepts either a string token or an object { token, tenant_id }
- On login, token is persisted and tenant_id (if available) is mirrored to activeTenant
- The shared API client (src/api/baseClient.js) automatically attaches:
  - Authorization: Bearer <token>
  - X-Tenant-Id: <tenant_id> (when available)
  - Optionally appends ?tenant_id=... when header is unsupported by the endpoint

Guidelines:
- Do not handcraft fetch or axios headers; always use:
  - getApiClient() for requests (preferred)
  - buildAuthHeaders() only when absolutely necessary (e.g., legacy utils)
- Never hardcode tenant_id. Always derive via getTenantId() or rely on the interceptor.

Environment:
- REACT_APP_API_BASE_URL sets the base API URL when present
- No secrets are stored in code; JWT is read from localStorage "auth"
