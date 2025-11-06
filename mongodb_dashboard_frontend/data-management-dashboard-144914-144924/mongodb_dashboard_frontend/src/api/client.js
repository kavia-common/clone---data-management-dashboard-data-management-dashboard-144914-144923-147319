//
// PUBLIC_INTERFACE
// Basic API client for the dashboard frontend.
// - Stores/reads AccessToken and tenant_id from localStorage
// - Attaches Authorization: Bearer <token>
// - Adds x-tenant-id header for backend hints (backend still enforces tenant from token)
//
export function setAuthContext({ token, tenant_id }) {
  if (typeof token === 'string') localStorage.setItem('AccessToken', token);
  if (typeof tenant_id === 'string') localStorage.setItem('tenant_id', tenant_id);
}

export function getAuthContext() {
  return {
    token: localStorage.getItem('AccessToken') || null,
    tenant_id: localStorage.getItem('tenant_id') || null,
  };
}

export async function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const base = process.env.REACT_APP_API_BASE_URL || '';
  const url = `${base}${path}`;
  const { token, tenant_id } = getAuthContext();

  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  if (token) reqHeaders.Authorization = `Bearer ${token}`;
  if (tenant_id) reqHeaders['x-tenant-id'] = tenant_id;

  const resp = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (resp.status === 401) {
    // optionally handle logout
  }
  return resp;
}
