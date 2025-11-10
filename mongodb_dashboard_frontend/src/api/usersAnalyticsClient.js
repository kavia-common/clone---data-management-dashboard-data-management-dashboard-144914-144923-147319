import { getApiClient } from './index';
import { buildQueryString } from './util';


/**
 * PUBLIC_INTERFACE
 * fetchUsersByTenant
 * Standardized wrapper returning the backend response for /api/users/tenant-summary
 */
export async function fetchUsersByTenant({ status, includeInactive } = {}) {
  const base = { status, includeInactive };
  const qs = buildQueryString(base);
  const res = await getApiClient().get(`/api/users/tenant-summary${qs}`);
  return res.data ?? res;
}

/**
 * PUBLIC_INTERFACE
 * fetchReferralSources
 * Wrapper for /api/users/referral-sources
 */
export async function fetchReferralSources({ limit = 10 } = {}) {
  const base = { limit };
  const qs = buildQueryString(base);
  const res = await getApiClient().get(`/api/users/referral-sources${qs}`);
  return res.data ?? res;
}

export default { fetchUsersByTenant, fetchReferralSources };
