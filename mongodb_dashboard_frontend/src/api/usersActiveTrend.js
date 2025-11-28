import { getApiClient } from './baseClient';
import { getApiBase } from './config';

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users over time WITHOUT daily/weekly aggregation.
 *
 * Notes:
 * - Legacy query params granularity/day/week are ignored on purpose.
 * - We only pass range (from,to) and optional tenant scope; backend returns raw items.
 * - Callers should render series directly from raw items for the selected range.
 *
 * @param {Object} params - Query params
 * @param {string|Date} [params.from] - ISO or Date start (inclusive)
 * @param {string|Date} [params.to] - ISO or Date end (inclusive)
 * @param {string} [params.status] - Optional statuses filter for legacy endpoint (ignored if not supported)
 * @param {string} [params.tenantId] - Optional tenant scope (mapped to tenant_id query param)
 * @returns {Promise<{items: Array<any>, meta: any}>}
 */
export async function getActiveUsersTrend(params = {}) {
  const { from, to, status, tenantId } = params || {};

  const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

  // Build minimal query, explicitly excluding legacy aggregation/granularity params
  const qs = new URLSearchParams();
  if (from) qs.set('from', toIso(from));
  if (to) qs.set('to', toIso(to));
  if (tenantId) qs.set('tenant_id', tenantId);
  // status may be honored by backend; if not, it's harmless
  if (status) qs.set('status', status);

  const baseUrl = getApiBase();
  const api = getApiClient();

  const url = `${baseUrl}/users/active-trend?${qs.toString()}`;
  const res = await api.get(url);
  const data = res?.data ?? res;

  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response');
  }

  // Normalize outputs; allow both raw array and { items, meta }
  if (Array.isArray(data)) {
    return { items: data, meta: {} };
  }
  if (!data.items && data.data && Array.isArray(data.data)) {
    return { items: data.data, meta: data.meta || {} };
  }

  return {
    items: Array.isArray(data.items) ? data.items : [],
    meta: data.meta || {},
  };
}

const apiUsersActiveTrend = {
  getActiveUsersTrend,
};

export default apiUsersActiveTrend;
