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
 * @param {string} [params.tenant_id]
 * @param {string} [params.start] ISO string (optional - inclusive lower bound)
 * @param {string} [params.end] ISO string (optional - inclusive upper bound)
 * @param {string} [params.sort]
 * @param {Object|string} [params.filter] JSON string or object for server-side filtering
 * @param {string} [params.q] Text search query
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}) {
  // Only allow allowed keys through (no from/to support)
  const { page, limit, tenant_id, start, end, sort, filter, q } = params;
  const safeParams = {};
  if (page !== undefined) safeParams.page = page;
  if (limit !== undefined) safeParams.limit = limit;
  if (tenant_id !== undefined) safeParams.tenant_id = tenant_id;
  if (start !== undefined) safeParams.start = start;
  if (end !== undefined) safeParams.end = end;
  if (sort !== undefined) safeParams.sort = sort;
  if (filter !== undefined) safeParams.filter = typeof filter === 'object' ? JSON.stringify(filter) : filter;
  if (q !== undefined) safeParams.q = q;
  // Only these allowed; do NOT include from/to!
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
