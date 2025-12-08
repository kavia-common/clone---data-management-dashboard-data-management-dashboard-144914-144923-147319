import { getApiClient } from './baseClient';
import { buildQueryString } from './util';

/**
 * PUBLIC_INTERFACE
 * fetchSessionTracking
 * Fetch session tracking records with pagination, sorting, optional text search and server-side time filtering.
 * Accepts optional options including AbortController signal for in-flight cancellation.
 *
 * @param {Object} params
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {string} [params.tenant_id] Active tenant scope (alias: organization_id on server)
 * @param {string} [params.sort]
 * @param {string} [params.q] Text search query
 * @param {string} [params.start] ISO date-time lower bound (inclusive)
 * @param {string} [params.end] ISO date-time upper bound (inclusive)
 * @param {string} [params.filter] JSON string for server-side filter (e.g., {"service_type":"notebook"})
 * @param {Object} [options] optional options like { signal }
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}, options = {}) {
  const {
    page, limit, tenant_id, sort, q, start, end, filter,
  } = params || {};

  const safeParams = {};
  if (page !== undefined) safeParams.page = page;
  if (limit !== undefined) safeParams.limit = limit;
  if (tenant_id !== undefined) safeParams.tenant_id = tenant_id;
  if (sort !== undefined) safeParams.sort = sort;
  if (q !== undefined) safeParams.q = q;
  if (start !== undefined) safeParams.start = start;
  if (end !== undefined) safeParams.end = end;
  if (filter !== undefined) safeParams.filter = filter;

  const qs = buildQueryString(safeParams);
  const url = `/api/session-tracking${qs}`;
  const cfg = {};
  if (options && options.signal) {
    cfg.signal = options.signal;
  }
  const res = await getApiClient().get(url, cfg);
  const payload = res?.data ?? res;

  const items = Array.isArray(payload) ? payload : payload?.data ?? [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === 'number' && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  const meta = payload?.meta ?? null;

  return { items, total, meta };
}

/* No default export to favor named exports (lint rule) */
