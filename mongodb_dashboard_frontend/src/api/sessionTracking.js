import { getApiClient } from './baseClient';
import { buildQueryString } from './util';
import { buildFilterParam } from './buildFilterParam';

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
 * @param {string} [params.from] Alias for start
 * @param {string} [params.to] Alias for end
 * @param {string} [params.start_date] Alias used in some components -> mapped to filter
 * @param {string} [params.end_date] Alias used in some components -> mapped to filter
 * @param {string} [params.sort]
 * @param {Object|string} [params.filter] JSON string or object for server-side filtering
 * @param {string} [params.q] Text search query
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}) {
  // Normalize aliases
  const {
    page, limit, tenant_id, start, end, from, to, start_date, end_date, sort, filter, q,
  } = params;

  // Prefer explicit start/end, else from/to
  const effStart = start || from || undefined;
  const effEnd = end || to || undefined;

  // If start_date/end_date were given (UI convenience), translate into a filter that checks session_start/session_end ranges
  let effFilter = filter;
  if ((start_date || end_date) && !effStart && !effEnd) {
    const s = start_date || undefined;
    const e = end_date || undefined;
    const range = {};
    if (s) range.$gte = s;
    if (e) range.$lte = e;
    const f = {
      $or: [
        { session_start: range },
        { session_end: range },
        { last_updated: range },
      ],
    };
    effFilter = typeof filter === 'object'
      ? { $and: [filter, f] }
      : f;
  }

  const safeParams = {};
  if (page !== undefined) safeParams.page = page;
  if (limit !== undefined) safeParams.limit = limit;
  if (tenant_id !== undefined) safeParams.tenant_id = tenant_id;
  if (effStart !== undefined) safeParams.start = effStart;
  if (effEnd !== undefined) safeParams.end = effEnd;
  if (sort !== undefined) safeParams.sort = sort;
  if (q !== undefined) safeParams.q = q;

  if (effFilter !== undefined) {
    // Accept object or pre-encoded string; if object ensure encoded JSON
    if (typeof effFilter === 'string') {
      safeParams.filter = effFilter;
    } else {
      const encoded = buildFilterParam(effFilter);
      if (encoded) safeParams.filter = encoded;
    }
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
