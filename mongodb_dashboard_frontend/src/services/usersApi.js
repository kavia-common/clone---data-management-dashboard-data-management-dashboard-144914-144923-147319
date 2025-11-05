import { getActiveUsersTrend } from "../api/usersAnalytics";

/**
 * PUBLIC_INTERFACE
 * fetchActiveUsersByBucket
 * Convenience wrapper that maps UI bucket to backend granularity and forwards
 * the request to /api/users/active-trend.
 *
 * @param {'daily'|'weekly'|'monthly'} bucket
 * @param {{ from?: string, to?: string, status?: string, tenant_id?: string }} params
 * @returns {Promise<{ items: Array<{ date: string, total: number }>, meta?: any }>}
 */
export async function fetchActiveUsersByBucket(bucket, params = {}) {
  const granularity = bucket === "weekly" || bucket === "month" ? "week" : "day";
  return getActiveUsersTrend({ ...params, granularity });
}

export default { fetchActiveUsersByBucket };
