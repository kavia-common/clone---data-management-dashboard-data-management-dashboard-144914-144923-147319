/** PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Calls the stable analytics endpoint /api/analytics/users/active-trend and normalizes
 * the response to { items: [{ date, total }], meta } for UI consumption.
 */
import { getApiBaseUrl } from './util';
import { buildAuthHeaders, getOrganizationId } from './authTokenProvider';

function resolveBase() {
  const envBase = (typeof getApiBaseUrl === 'function' && getApiBaseUrl()) || '';
  if (envBase) return String(envBase).replace(/\/*$/, '');
  try {
    const u = new URL(window.location.href);
    return `${u.protocol}//${u.hostname}:3001`;
  } catch {
    return 'http://localhost:3001';
  }
}

// PUBLIC_INTERFACE
export async function getActiveUsersTrend({ from, to, granularity = 'day', organization_id, status = 'completed|active' } = {}) {
  const base = resolveBase();
  const orgId = organization_id || getOrganizationId();
  const params = new URLSearchParams();
  if (granularity) params.set('granularity', granularity);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (orgId) params.set('organization_id', orgId);
  if (status) params.set('status', status);

  const url = `${base}/api/analytics/users/active-trend?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders({ Accept: 'application/json' }),
    credentials: 'omit',
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};

  if (!res.ok) {
    // Return empty-series compatible shape
    return { items: [], meta: { granularity, from, to } };
  }

  // New endpoint returns {labels, datasets}
  if (payload && Array.isArray(payload.labels) && Array.isArray(payload.datasets)) {
    const ds = payload.datasets[0] || { data: [] };
    const items = payload.labels.map((label, i) => ({
      date: String(label),
      total: Number(ds.data[i] || 0),
    }));
    return { items, meta: payload.meta || { granularity, from, to } };
  }

  // Old endpoint returns {items:[{date,total}]}
  if (payload && Array.isArray(payload.items)) {
    return { items: payload.items.map(r => ({ date: String(r.date), total: Number(r.total || 0) })), meta: payload.meta || { granularity, from, to } };
  }

  return { items: [], meta: { granularity, from, to } };
}

export default { getActiveUsersTrend };
