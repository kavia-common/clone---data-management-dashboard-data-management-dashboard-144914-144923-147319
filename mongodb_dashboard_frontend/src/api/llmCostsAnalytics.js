/** PUBLIC_INTERFACE
 * getLlmCostsOverTime
 * Fetches analytics costs over time: { labels, datasets: [{label,data}], meta }
 * Accepts { from, to, granularity, organization_id? }.
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
export async function getLlmCostsOverTime({ from, to, granularity = 'day', organization_id } = {}) {
  const base = resolveBase();
  const orgId = organization_id || getOrganizationId();
  const params = new URLSearchParams();
  if (granularity) params.set('granularity', granularity);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (orgId) params.set('organization_id', orgId);
  const url = `${base}/api/analytics/llm-costs/over-time?${params.toString()}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: buildAuthHeaders({ Accept: 'application/json' }),
    credentials: 'omit',
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    // Return empty-series for charts, not to crash UI
    return { labels: [], datasets: [{ label: 'Total Cost', data: [] }], meta: { granularity, from, to } };
  }
  // Normalize numeric data
  if (!payload || !Array.isArray(payload.labels)) {
    return { labels: [], datasets: [{ label: 'Total Cost', data: [] }], meta: { granularity, from, to } };
  }
  return payload;
}

export default { getLlmCostsOverTime };
