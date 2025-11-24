import { baseClient } from './baseClient';
import { getApiBase } from './config';

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users time series.
 *
 * Strategy:
 * 1) Prefer backend active users trend from USERS collection if available:
 *    GET /api/users/active-trend-from-users?granularity=day|week&start=&end=
 *    - Treat organization_id as tenant scope (auto-injected by baseClient)
 *    - active user: updated_at within range, status != 'deleted'
 * 2) Fallback to sessions-based endpoint:
 *    GET /api/users/active-trend (session_tracking derived)
 *
 * @param {Object} params - Query params
 * @param {string|Date} [params.from] - ISO or Date start (inclusive)
 * @param {string|Date} [params.to] - ISO or Date end (inclusive)
 * @param {'day'|'week'} [params.granularity='day'] - Bucket size
 * @param {string} [params.status] - Optional statuses filter for legacy endpoint
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

  const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

  // Build query for both endpoints
  const usersQuery = new URLSearchParams();
  if (from) usersQuery.set('start', toIso(from));
  if (to) usersQuery.set('end', toIso(to));
  if (granularity) usersQuery.set('granularity', granularity);
  if (tenantId) usersQuery.set('tenant_id', tenantId); // baseClient should also inject organization_id

  const legacyQuery = new URLSearchParams();
  if (from) legacyQuery.set('from', toIso(from));
  if (to) legacyQuery.set('to', toIso(to));
  if (granularity) legacyQuery.set('granularity', granularity);
  if (status) legacyQuery.set('status', status);
  if (tenantId) legacyQuery.set('tenant_id', tenantId);

  const baseUrl = getApiBase();

  // Try users-backed analytics endpoint first
  try {
    const urlUsers = `${baseUrl}/users/active-trend-from-users?${usersQuery.toString()}`;
    const resUsers = await baseClient.get(urlUsers);
    if (resUsers && (Array.isArray(resUsers.items) || Array.isArray(resUsers))) {
      if (!resUsers.items) {
        return { items: Array.isArray(resUsers) ? resUsers : [], meta: { granularity } };
      }
      return resUsers;
    }
  } catch (e) {
    // proceed to fallback
  }

  // Fallback to sessions-backed endpoint
  const url = `${baseUrl}/users/active-trend?${legacyQuery.toString()}`;
  const res = await baseClient.get(url);
  if (!res || typeof res !== 'object') {
    throw new Error('Invalid response');
  }
  if (!res.items) {
    return { items: Array.isArray(res) ? res : [], meta: {} };
  }
  return res;
}

export const usersActiveTrendApi = {
  // PUBLIC_INTERFACE
  getActiveUsersTrend,
};
