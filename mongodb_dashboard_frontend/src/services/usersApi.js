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
  // Map UI buckets to backend granularity:
  // - daily -> day
  // - weekly -> week
  // - monthly -> month
  let granularity = "day";
  if (bucket === "weekly") granularity = "week";
  if (bucket === "monthly") granularity = "month";

  // Forward status if provided; backend expects pipe-separated string (e.g., "completed|active")
  const { status, ...rest } = params || {};
  const query = { ...rest, granularity };
  if (typeof status === "string" && status.trim().length > 0) {
    query.status = status.trim();
  }
  return getActiveUsersTrend(query);
}

export default { fetchActiveUsersByBucket };
