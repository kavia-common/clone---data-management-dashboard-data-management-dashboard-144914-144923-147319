import { getApiClient } from './client';

/**
 * PUBLIC_INTERFACE
 * Fetch authorized tenants for current user.
 */
export async function fetchAuthorizedTenants() {
  const api = getApiClient();
  const res = await api.get('/session/tenants');
  const payload = res?.data || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  return { items, total: payload.total || items.length };
}

/**
 * PUBLIC_INTERFACE
 * Set active tenant on the server-side session context. Also returns the confirmed active tenant id.
 */
export async function setActiveTenant(tenantId, reason) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId must be a non-empty string');
  }
  const api = getApiClient();
  const res = await api.post('/session/tenant', { tenantId, reason });
  return res?.data || { success: true, activeTenant: tenantId };
}
