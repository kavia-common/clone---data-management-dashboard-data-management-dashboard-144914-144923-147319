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
export async function fetchFeaturesUsage({ from, to, tenant_id, user_id, limit = 8 } = {}) {
  try {
    const params = new URLSearchParams();
    const start = toIsoOrUndefined(from);
    const end = toIsoOrUndefined(to);

    if (start) params.set("from", start);
    if (end) params.set("to", end);
    if (tenant_id) params.set("tenant_id", tenant_id);
    if (user_id) params.set("user_id", user_id);
    if (limit) params.set("limit", String(limit));

    // ✅ Updated endpoint: fetches directly from MongoDB aggregation
    const res = await api.get(`/api/features-usage?${params.toString()}`);

    if (!res || !res.data) {
      console.warn("[fetchFeaturesUsage] Empty or invalid response from API");
      return { mostUsed: [], leastUsed: [] };
    }

    const data = res.data;

    // ✅ Normalize for consistent frontend shape
    return {
      mostUsed: (data.mostUsed || data.top || data.items?.most || []).map((x) => ({
        name: x.name || x.feature || x._id || "Unknown",
        count: x.count || 0,
      })),
      leastUsed: (data.leastUsed || data.bottom || data.items?.least || []).map((x) => ({
        name: x.name || x.feature || x._id || "Unknown",
        count: x.count || 0,
      })),
    };
  } catch (error) {
    console.error("[fetchFeaturesUsage] Failed to fetch:", error);
    return { mostUsed: [], leastUsed: [] };
  }
}
