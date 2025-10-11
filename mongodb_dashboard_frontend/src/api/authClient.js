import { API_BASE_URL } from '../config/auth';
import { encryptTenantId } from '../utils/crypto';
import { resolveAuthEndpointUrl } from './urlOverrides';

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
export async function loginWithOrgEmailPassword({ organizationId, email, password, salt }) {
  /** Calls POST /api/auth/login with body { organization_id: <encrypted>, email, password }.
   * Encrypts org id using AES-128-ECB and base64 without padding.
   * Returns token (if any) and the raw response text/json.
   */
  if (!organizationId) throw new Error('organizationId is required');
  if (!email) throw new Error('email is required');
  if (!password) throw new Error('password is required');

  const encryptedOrg = encryptTenantId(organizationId, salt);
  // Route login via resolveAuthEndpointUrl so that only this endpoint is forced to the external domain.
  // Other non-auth endpoints should keep using the base client logic.
  const url = resolveAuthEndpointUrl(`/api/auth/login`, API_BASE_URL);
  const body = { organization_id: encryptedOrg, email, password };

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
    const msg =
      typeof payload === 'string'
        ? payload
        : payload?.message ||
          (payload?.detail && Array.isArray(payload.detail) ? payload.detail.map(d => d.msg).join(', ') : null) ||
          'Login failed';
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
