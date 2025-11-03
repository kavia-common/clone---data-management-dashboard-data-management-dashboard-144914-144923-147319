import { getApiClient } from "../api/client";

/**
 * PUBLIC_INTERFACE
 * fetchFeaturesUsage
 * Calls backend GET /api/session-tracking/features-usage with aligned params.
 * Params:
 * - { from?: string|Date, to?: string|Date, tenant_id?: string, user_id?: string, user_name?: string, limit?: number }
 * Returns:
 *   { mostUsed: Array<{ feature: string, count: number }>,
 *     leastUsed: Array<{ feature: string, count: number }> }
 */
export async function fetchFeaturesUsage({ from, to, tenant_id, user_id, user_name, limit = 8 } = {}) {
  const api = getApiClient();

  const toIso = (d) => {
    if (!d) return undefined;
    try {
      const dd = new Date(d);
      return isNaN(dd.getTime()) ? undefined : dd.toISOString();
    } catch {
      return undefined;
    }
  };

  const params = {
    startDate: toIso(from),
    endDate: toIso(to),
    tenant_id,
    user_id,
    user_name,
    limit,
  };

  // Dev log of request URL and params
  if (process.env.NODE_ENV !== "production") {
    try {
      const usp = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") usp.append(k, String(v));
      });
      // eslint-disable-next-line no-console
      console.debug(`[featuresUsage.js] GET /api/session-tracking/features-usage?${usp.toString()}`);
    } catch {
      // ignore
    }
  }

  const res = await api.get("/api/session-tracking/features-usage", { params });
  const data = res?.data || {};

  const mostUsed = Array.isArray(data.mostUsed) ? data.mostUsed : [];
  const leastUsed = Array.isArray(data.leastUsed) ? data.leastUsed : [];

  // Dev log response lengths
  if (process.env.NODE_ENV !== "production") {
    try {
      // eslint-disable-next-line no-console
      console.debug(`[featuresUsage.js] response sizes: most=${mostUsed.length}, least=${leastUsed.length}`);
    } catch { /* ignore */ }
  }

  return {
    mostUsed: mostUsed.map((x) => ({
      feature: x.feature || x.name || x._id || "Unknown",
      count: x.count || 0,
    })),
    leastUsed: leastUsed.map((x) => ({
      feature: x.feature || x.name || x._id || "Unknown",
      count: x.count || 0,
    })),
  };
}

export default { fetchFeaturesUsage };
