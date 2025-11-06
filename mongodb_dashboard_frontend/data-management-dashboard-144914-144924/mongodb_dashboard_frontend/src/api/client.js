//
// PUBLIC_INTERFACE
// Basic API client for the dashboard frontend.
// - Stores/reads AccessToken and tenant_id from localStorage
// - Attaches Authorization: Bearer <token>
// - Adds x-tenant-id header for backend hints (backend still enforces tenant from token)
//
import { setToken, setTenantId, getToken, getTenantId } from './authStore';

export function setAuthContext({ token, tenant_id }) {
  if (typeof token === 'string') setToken(token);
  if (typeof tenant_id === 'string') setTenantId(tenant_id);
}

export function getAuthContext() {
  return {
    token: getToken(),
    tenant_id: getTenantId(),
  };
}

export async function apiFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const base = process.env.REACT_APP_API_BASE_URL || '';
  const url = `${base}${path}`;
  const { token, tenant_id } = getAuthContext();

  const reqHeaders = {
    'Content-Type': 'application/json',
    ...(tenant_id ? { 'x-tenant-id': tenant_id } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  const resp = await fetch(url, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (resp.status === 401) {
    // In a fuller app we would trigger a logout here
  }
  return resp;
}
