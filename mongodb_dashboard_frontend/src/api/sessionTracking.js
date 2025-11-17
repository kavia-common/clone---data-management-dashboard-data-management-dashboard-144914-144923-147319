import { getApiClient } from './baseClient';
import { buildQueryString } from './util';

/**
 * PUBLIC_INTERFACE
 * fetchSessionTracking
 * Fetch session tracking records with optional filters, pagination, and sorting.
 * Returns normalized { items, total, meta } envelope regardless of backend envelope/array shape.
 *
 * @param {Object} params
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {string} [params.sort]
 * @param {Object|string} [params.filter] JSON string or object for server-side filtering
 * @param {string} [params.q] Text search query
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}) {
  const safeParams = { ...params };
  // stringify filter object if necessary
  if (safeParams.filter && typeof safeParams.filter === 'object') {
    safeParams.filter = JSON.stringify(safeParams.filter);
  }
  const qs = buildQueryString(safeParams);
  const url = `/api/session-tracking${qs}`;
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
