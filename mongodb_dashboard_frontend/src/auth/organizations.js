/**
 * PUBLIC_INTERFACE
 * organizations client
 * Provides helpers for tenant-aware session operations and a global "all tenants" toggle for Super Admin.
 */
import http, { setAllTenantsEnabled, getAllTenantsEnabled } from '../lib/httpClient';

export async function fetchAuthorizedTenants() {
  const res = await http.get('/api/session/tenants');
  return res.data?.items || [];
}

export async function toggleAllTenants(enabled) {
  const res = await http.post('/api/session/all-tenants', { enabled: !!enabled });
  // Mirror local toggle state to keep UI indicator in sync
  setAllTenantsEnabled(!!res.data?.enabled);
  return res.data;
}

export function isAllTenantsEnabled() {
  return getAllTenantsEnabled();
}
