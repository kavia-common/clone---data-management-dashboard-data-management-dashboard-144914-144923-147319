import api from "../utils/api";

// Local helper to normalize from/to ISO strings
function toIsoOrUndefined(dateLike) {
  if (!dateLike) return undefined;
  try {
    const d = new Date(dateLike);
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * PUBLIC_INTERFACE
 * fetchFeaturesUsage
 * Fetches most and least used features directly from backend database.
 * Params:
 * - { from?: string, to?: string, tenant_id?: string, user_id?: string, limit?: number }
 * Returns:
 *   { mostUsed: Array<{ name: string, count: number }>,
 *     leastUsed: Array<{ name: string, count: number }> }
 */
export async function fetchFeaturesUsage({ from, to, tenant_id, user_id, limit = 8, serviceType } = {}) {
  try {
    const params = new URLSearchParams();
    const start = toIsoOrUndefined(from);
    const end = toIsoOrUndefined(to);

    // Default to last 30 days if not provided
    if (!start || !end) {
      const now = new Date();
      const fromDefault = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      params.set("from", start || fromDefault.toISOString());
      params.set("to", end || now.toISOString());
    } else {
      params.set("from", start);
      params.set("to", end);
    }

    if (tenant_id) params.set("tenant_id", tenant_id);
    if (user_id) params.set("user_id", user_id);
    if (limit) params.set("limit", String(limit));
    if (serviceType) params.set("serviceType", String(serviceType));
    // interval default day for server; can pass if needed in future

    // Call analytics feature usage endpoint
    const res = await api.get(`/api/analytics/feature-usage?${params.toString()}`);

    if (!res || !res.data) {
      console.warn("[fetchFeaturesUsage] Empty or invalid response from API");
      return { mostUsed: [], leastUsed: [] };
    }

    const data = res.data;

    // Server returns time-series features plus mostUsed/leastUsed names.
    // For bar charts, build arrays using aggregate totals if provided.
    const hasSeries = Array.isArray(data.features);
    let mostUsed = [];
    let leastUsed = [];

    if (hasSeries && data.features.length > 0) {
      const totals = data.features.map(f => ({
        feature: f.name || f.feature || "Unknown",
        count: typeof f.totalCount === "number" ? f.totalCount : (Array.isArray(f.series) ? f.series.reduce((acc, p) => acc + (p.count || 0), 0) : 0)
      }));
      // sort
      const sortedDesc = totals.slice().sort((a, b) => b.count - a.count);
      const sortedAsc = totals.slice().sort((a, b) => a.count - b.count || a.feature.localeCompare(b.feature));
      mostUsed = sortedDesc.slice(0, limit);
      // filter out zeros for least unless all are zero
      const nonZeroAsc = sortedAsc.filter(x => x.count > 0);
      leastUsed = (nonZeroAsc.length > 0 ? nonZeroAsc : sortedAsc).slice(0, limit);
    } else {
      // Fallback to legacy shape if present
      mostUsed = (data.mostUsed || data.top || data.items?.most || []).map(x => ({
        feature: x.feature || x.name || x._id || "Unknown",
        count: x.count || 0
      }));
      leastUsed = (data.leastUsed || data.bottom || data.items?.least || []).map(x => ({
        feature: x.feature || x.name || x._id || "Unknown",
        count: x.count || 0
      }));
    }

    return {
      mostUsed: mostUsed.map(x => ({ name: x.feature || x.name || "Unknown", count: x.count || 0 })),
      leastUsed: leastUsed.map(x => ({ name: x.feature || x.name || "Unknown", count: x.count || 0 })),
    };
  } catch (error) {
    console.error("[fetchFeaturesUsage] Failed to fetch:", error);
    return { mostUsed: [], leastUsed: [] };
  }
}
