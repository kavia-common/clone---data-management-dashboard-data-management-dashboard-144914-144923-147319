import { API_BASE_URL } from '../config/auth';
import { encryptTenantId } from '../utils/crypto';

// PUBLIC_INTERFACE
export async function fetchUserOrganizationsByEmail(email) {
  /** Calls GET /api/auth/user-organizations?email=<email> and returns array of orgs.
   * Returns [] on 404 or empty.
   */
  const url = `${API_BASE_URL}/api/auth/user-organizations?email=${encodeURIComponent(email)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    credentials: 'include',
  });
  if (res.ok) {
    const data = await res.json().catch(() => null);
    // Ensure array
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return data ? [data] : [];
  }
  if (res.status === 404) {
    return [];
  }
  const text = await res.text().catch(() => '');
  throw new Error(`Failed to fetch organizations: ${res.status} ${text}`);
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
  const url = `${API_BASE_URL}/api/auth/login`;
  const body = {
    organization_id: encryptedOrg,
    email,
    password,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/plain' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  // Backend may return plain text or JSON; try parse
  const contentType = res.headers.get('content-type') || '';
  let payload;
  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => ({}));
  } else {
    payload = await res.text().catch(() => '');
  }

  if (!res.ok) {
    const msg = typeof payload === 'string' ? payload : payload?.message || 'Login failed';
    const err = new Error(msg);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  // Try to extract token if returned
  let token = null;
  if (typeof payload === 'string') {
    // If server returns a token string, accept it
    token = payload;
  } else if (payload && (payload.token || payload.access_token)) {
    token = payload.token || payload.access_token;
  }

  return { token, payload };
}
