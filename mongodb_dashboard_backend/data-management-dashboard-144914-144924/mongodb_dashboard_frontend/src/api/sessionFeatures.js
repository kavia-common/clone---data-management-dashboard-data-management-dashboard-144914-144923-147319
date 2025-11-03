import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * getFeaturesUsage
 * Fetches features usage aggregated counts from backend.
 * Params:
 *  - startDate, endDate (ISO strings, inclusive UTC)
 *  - user_name (string; backend uses user_name_lower for matching)
 *  - tenant_id (string)
 *  - status (optional string)
 *  - limit (number, default 5)
 *  - minCount (number, default 1)
 *
 * Returns: { mostUsed: [{feature,count}], leastUsed: [{feature,count}], meta }
 */
export async function getFeaturesUsage(params = {}) {
  const api = getApiClient();
  const res = await api.get("/session-tracking/features-usage", { params });
  return res?.data || { mostUsed: [], leastUsed: [], meta: null, success: false };
}

export default { getFeaturesUsage };
