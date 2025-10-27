
import { API_BASE_URL } from "../config/auth";
import { generateOrganizationId, isTenantSaltValid } from "../utils/crypto";
import { resolveAuthEndpointUrl } from "./urlOverrides";


// PUBLIC_INTERFACE
export async function fetchUserOrganizationsByEmail(email) {
  /** Calls GET /api/auth/user-organizations?email=<email> and returns response as-is:
   * { email: string, organizations: Array<{ id: string, name: string }>}
   * Throws on non-2xx (other than 404). For 404 returns { email, organizations: [] }.
   *
   * Special handling: This endpoint is forced to use the absolute external domain
   * https://kaviaqa-worktool.cloud.kavia.ai by design. Other endpoints continue to use API_BASE_URL.
   */
  const relativePath = `/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const url = resolveAuthEndpointUrl(relativePath, API_BASE_URL);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    // Do not rely on proxy/cookies
    credentials: 'omit',
  });

  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    return data && typeof data === 'object'
      ? data
      : { email, organizations: [] };
  }

  if (res.status === 404) {
    return { email, organizations: [] };
  }

  const text = await res.text().catch(() => '');
  const err = new Error(`Failed to fetch organizations: ${res.status} ${text}`);
  err.status = res.status;
  throw err;
}

// PUBLIC_INTERFACE
export async function loginWithOrgEmailPassword({ organizationId, email, password }) {
  /** Calls POST /api/auth/login with body { organization_id: REACT_APP_SECRET_SALT, email, password }.
   * Note: organization_id must be EXACTLY the configured secret salt. No encryption or encoding.
   * Returns token (if any) and the raw response text/json.
   */
  if (!email) throw new Error('email is required');
  if (!password) throw new Error('password is required');

  if (!isTenantSaltValid()) {
    const err = new Error('Login cannot proceed: tenant secret salt is not configured.');
    err.code = 'SALT_NOT_CONFIGURED';
    throw err;
  }

  // const organization_id = VALIDATED_TENANT_SALT;
  const organization_id = generateOrganizationId(email);

  const url = resolveAuthEndpointUrl(`/api/auth/login`, API_BASE_URL);
  const body = { organization_id, email, password };

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('Auth payload preview', { organization_id, email, password: '[REDACTED]' });
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain',
    },
    body: JSON.stringify(body),
    credentials: 'omit',
  });

  const contentType = res.headers.get('content-type') || '';
  let payload;
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => ({}));
  } else {
    payload = await res.text().catch(() => '');
  }

  if (!res.ok) {
    const baseMsg =
      typeof payload === 'string'
        ? payload
        : payload?.message ||
          (payload?.detail && Array.isArray(payload.detail) ? payload.detail.map(d => d.msg).join(', ') : null) ||
          `Login failed (${res.status})`;

    const msg = res.status === 500
      ? `${baseMsg}. The server reported an internal error. If you are using a placeholder QA salt, please configure a valid salt.`
      : baseMsg;

    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  let token = null;
  if (typeof payload === 'string') {
    token = payload;
  } else if (payload && (payload.token || payload.access_token)) {
    token = payload.token || payload.access_token;
  }

  return { token, payload };
}
