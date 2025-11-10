import baseClient from './baseClient';
import { getApiBase } from './config';

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users time series from backend.
 *
 * @param {Object} params - Query params
 * @param {string|Date} [params.from] - ISO or Date start (inclusive)
 * @param {string|Date} [params.to] - ISO or Date end (exclusive upper bound)
 * @param {'day'|'week'} [params.granularity='day'] - Bucket size
 * @param {string} [params.status] - Pipe-separated statuses filter (e.g., 'completed|active')
 * @param {string} [params.tenantId] - Optional tenant scope (mapped to tenant_id query param)
 * @returns {Promise<{items: Array<{date: string, total: number}>, meta: any}>}
 */
export async function getActiveUsersTrend(params = {}) {
  const {
    from,
    to,
    granularity = 'day',
    status,
    tenantId,
  } = params;

  // Normalize dates to ISO strings if Date provided
  const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

  const query = new URLSearchParams();
  if (from) query.set('from', toIso(from));
  if (to) query.set('to', toIso(to));
  if (granularity) query.set('granularity', granularity);
  if (status) query.set('status', status);
  if (tenantId) query.set('tenant_id', tenantId);

  const baseUrl = getApiBase();
  const url = `${baseUrl}/users/active-trend?${query.toString()}`;

  const res = await baseClient.get(url);
  // Expecting { items: [...], meta: {...} }
  if (!res || typeof res !== 'object') {
    throw new Error('Invalid response');
  }
  if (!res.items) {
    // Some servers might return array directly; normalize
    return { items: Array.isArray(res) ? res : [], meta: {} };
  }
  return res;
}

export default {
  // PUBLIC_INTERFACE
  getActiveUsersTrend,
};
