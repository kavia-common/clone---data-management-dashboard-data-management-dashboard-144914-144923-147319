import { getApiClient } from './index';
import { buildQueryString } from './util';

/**
 * Note: /api/users/tenant-summary is no longer used in the frontend.
 * Keep only referral sources helper here.
 */

// PUBLIC_INTERFACE
export async function fetchReferralSources({ limit = 10 } = {}) {
  const base = { limit };
  const qs = buildQueryString(base);
  const res = await getApiClient().get(`/api/users/referral-sources${qs}`);
  return res.data ?? res;
}

export default { fetchReferralSources };
