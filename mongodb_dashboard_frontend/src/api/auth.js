/* eslint-disable no-console */
import client, { setAuthContext } from './client';

// PUBLIC_INTERFACE
export async function login({ organization_id, email, password }) {
  /**
   * Calls backend /auth/login and stores { token, tenant_id } to localStorage on success.
   */
  const res = await client.post('/auth/login', { organization_id, email, password });
  const data = res.data || {};
  if (data && (data.token || data.id_token)) {
    const token = data.id_token || data.token;
    // Prefer tenant from payload; else keep existing
    const tenant_id = data.tenant_id || data['custom:tenant_id'] || null;
    setAuthContext({ token, tenant_id });
  }
  return data;
}

// PUBLIC_INTERFACE
export async function selectTenant(tenantId, reason = 'user_selection') {
  /**
   * Sets active tenant for session and persists in local storage context.
   */
  const res = await client.post('/session/tenant', { tenantId, reason });
  const ctx = JSON.parse(localStorage.getItem('authContext') || '{}');
  setAuthContext({ token: ctx.token || null, tenant_id: tenantId });
  return res.data;
}

// PUBLIC_INTERFACE
export function logout() {
  /**
   * Clears auth context.
   */
  localStorage.removeItem('authContext');
}
