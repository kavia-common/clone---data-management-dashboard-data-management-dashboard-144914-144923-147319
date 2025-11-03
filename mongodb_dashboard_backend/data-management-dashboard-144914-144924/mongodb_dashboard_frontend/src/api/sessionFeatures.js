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

  // Dev log request URL
  if (process.env.NODE_ENV !== "production") {
    try {
      const usp = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") usp.append(k, String(v));
      });
      // eslint-disable-next-line no-console
      console.debug(`[sessionFeatures.js] GET /session-tracking/features-usage?${usp.toString()}`);
    } catch { /* ignore */ }
  }

  const res = await api.get("/session-tracking/features-usage", { params });
  const data = res?.data || { mostUsed: [], leastUsed: [], meta: null, success: false };

  if (process.env.NODE_ENV !== "production") {
    try {
      // eslint-disable-next-line no-console
      console.debug(
        `[sessionFeatures.js] response sizes: most=${Array.isArray(data.mostUsed) ? data.mostUsed.length : 0}, least=${Array.isArray(data.leastUsed) ? data.leastUsed.length : 0}`
      );
    } catch { /* ignore */ }
  }
  return data;
}

export default { getFeaturesUsage };
