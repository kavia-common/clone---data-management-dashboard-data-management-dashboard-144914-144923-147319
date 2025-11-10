import { getApiClient } from './index';
import { buildQueryString } from './util';


/**
 * PUBLIC_INTERFACE
 * fetchActiveUsersTrend
 * Accepts startDate/endDate (preferred) or legacy from/to; also supports granularity, status, and tenant_id.
 */
export async function fetchActiveUsersTrend({ granularity = 'day', status, tenant_id } = {}) {
  const base = { granularity, status, tenant_id };
  const qs = buildQueryString(base);
  const url = `/api/users/active-trend${qs}`;
  const res = await getApiClient().get(url);
  return res.data ?? res;
}

export default { fetchActiveUsersTrend };
