import { getApiClient } from './baseClient';

/**
 * PUBLIC_INTERFACE
 * Fetch session tracking records using only start and end (and optionally tenant_id).
 * Omits legacy and pagination params.
 * @typedef {Object} SessionTrackingParams
 * @property {string|Date} start - ISO date string or Date instance (inclusive)
 * @property {string|Date} end - ISO date string or Date instance (inclusive)
 * @property {string} [tenant_id] - optional tenant_id for multi-tenant apps
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking({ start, end, tenant_id } = {}) {
  const params = new URLSearchParams();
  if (start) params.append("start", new Date(start).toISOString());
  if (end) params.append("end", new Date(end).toISOString());
  if (tenant_id) params.append("tenant_id", tenant_id);

  const url = `/api/session-tracking?${params.toString()}`;
  const res = await getApiClient().get(url);
  const payload = res?.data ?? res;

  const items = Array.isArray(payload) ? payload : payload?.data ?? [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === 'number' && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  const meta = payload?.meta ?? null;

  return { items, total, meta };
}

export default { fetchSessionTracking };
