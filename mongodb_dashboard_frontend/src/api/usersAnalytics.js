import { getApiBase } from './utilBase';

// PUBLIC_INTERFACE
export async function fetchMostActiveUsers({ range = '30d', granularity = 'daily', topN = 5, token, tenantId } = {}) {
  /** Fetch "Most Active Users" time series scoped to current tenant.
   * Returns: { buckets: [YYYY-MM-DD...], series: [{ user, label, data: number[] }], range, granularity }
   */
  const params = new URLSearchParams({ range, granularity, topN: String(topN) }).toString();
  const base = getApiBase();
  const url = `${base}/api/users/most-active?${params}`;

  const headers = { 'Content-Type': 'application/json' };
  // Authorization header if token provided (frontend should store it post-login)
  if (token) headers.Authorization = `Bearer ${token}`;
  // Pass tenant selection to backend
  if (tenantId) headers['X-Tenant-Id'] = tenantId;

  const res = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    return { buckets: [], series: [], range, granularity };
  }
  return res.json();
}
