import { getApiClient } from './index';
import { buildQueryString } from './util';
import { withDateParams } from './utilDateParams';

/**
 * PUBLIC_INTERFACE
 * fetchUsersByTenant
 * Standardized wrapper returning the backend response for /api/users/tenant-summary
 */
export async function fetchUsersByTenant({ startDate, endDate, from, to, status, includeInactive } = {}) {
  const base = { status, includeInactive };
  const params = withDateParams(base, { startDate, endDate, from, to });
  const qs = buildQueryString(params);
  const res = await getApiClient().get(`/api/users/tenant-summary${qs}`);
  return res.data ?? res;
}

/**
 * PUBLIC_INTERFACE
 * fetchReferralSources
 * Wrapper for /api/users/referral-sources
 */
export async function fetchReferralSources({ limit = 10, startDate, endDate, from, to } = {}) {
  const base = { limit };
  const params = withDateParams(base, { startDate, endDate, from, to });
  const qs = buildQueryString(params);
  const res = await getApiClient().get(`/api/users/referral-sources${qs}`);
  return res.data ?? res;
}

export default { fetchUsersByTenant, fetchReferralSources };
