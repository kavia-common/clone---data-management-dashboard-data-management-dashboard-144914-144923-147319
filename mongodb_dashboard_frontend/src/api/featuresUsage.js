import api from '../utils/api';

// Local helper to normalize from/to ISO strings
function toIsoOrUndefined(dateLike) {
  if (!dateLike) return undefined;
  try {
    const d = new Date(dateLike);
    if (isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * PUBLIC_INTERFACE
 * fetchFeaturesUsage
 * Fetches most and least used features given filters.
 * Params:
 * - { from?: string, to?: string, tenant_id?: string, user_id?: string, limit?: number }
 * Returns: { mostUsed: Array<{feature:string,count:number}>, leastUsed: Array<{feature:string,count:number}> }
 */
export async function fetchFeaturesUsage({ from, to, tenant_id, user_id, limit = 8 } = {}) {
  const params = new URLSearchParams();
  const start = toIsoOrUndefined(from);
  const end = toIsoOrUndefined(to);
  if (start) params.set('from', start);
  if (end) params.set('to', end);
  if (tenant_id) params.set('tenant_id', tenant_id);
  if (user_id) params.set('user_id', user_id);
  if (limit) params.set('limit', String(limit));

  // Attempt to call optimized analytics endpoints if available.
  // Fallback: derive from /api/session-tracking list (client-side aggregate).
  try {
    const res = await api.get(`/api/sessions-analytics/features-usage?${params.toString()}`);
    if (res) {
      // Support multiple backend shapes
      if (Array.isArray(res.items)) {
        return {
          mostUsed: Array.isArray(res.items?.most) ? res.items.most : [],
          leastUsed: Array.isArray(res.items?.least) ? res.items.least : [],
        };
      }
      if (Array.isArray(res.mostUsed) || Array.isArray(res.leastUsed)) {
        return {
          mostUsed: Array.isArray(res.mostUsed) ? res.mostUsed : [],
          leastUsed: Array.isArray(res.leastUsed) ? res.leastUsed : [],
        };
      }
      if (Array.isArray(res.most) || Array.isArray(res.least)) {
        return {
          mostUsed: Array.isArray(res.most) ? res.most : [],
          leastUsed: Array.isArray(res.least) ? res.least : [],
        };
      }
    }
  } catch (e) {
    // ignore and try next endpoint
  }

  // Try backend session-tracking aggregation endpoint if available
  try {
    const res2 = await api.get(`/api/session-tracking/features-usage?${params.toString()}`);
    if (res2) {
      if (Array.isArray(res2.mostUsed) || Array.isArray(res2.leastUsed)) {
        return {
          mostUsed: Array.isArray(res2.mostUsed) ? res2.mostUsed : [],
          leastUsed: Array.isArray(res2.leastUsed) ? res2.leastUsed : [],
        };
      }
      if (Array.isArray(res2.items?.most) || Array.isArray(res2.items?.least)) {
        return {
          mostUsed: Array.isArray(res2.items?.most) ? res2.items.most : [],
          leastUsed: Array.isArray(res2.items?.least) ? res2.items.least : [],
        };
      }
    }
  } catch (e) {
    // ignore and fallback to client-side aggregation
  }

  // Fallback: aggregate from session-tracking (client-side)
  const listParams = new URLSearchParams();
  if (start) listParams.set('startDate', start);
  if (end) listParams.set('endDate', end);
  if (tenant_id || user_id) {
    const filter = {};
    if (tenant_id) filter.tenant_id = tenant_id;
    if (user_id) filter.user_id = user_id;
    listParams.set('filter', JSON.stringify(filter));
  }
  // Request a reasonable cap to avoid huge client aggregation
  listParams.set('limit', '200');

  const records = await api.get(`/api/session-tracking?${listParams.toString()}`);
  const items = Array.isArray(records) ? records : (records?.data || records?.items || []);
  const counts = new Map();

  for (const rec of items) {
    // Try common shapes: rec.features, rec.actions, rec.session_data?.features
    const f1 = Array.isArray(rec?.features) ? rec.features : [];
    const f2 = Array.isArray(rec?.actions) ? rec.actions : [];
    const f3 = Array.isArray(rec?.session_data?.features) ? rec.session_data.features : [];
    const featureList = [...f1, ...f2, ...f3]
      .map((v) => (typeof v === 'string' ? v : v?.name || v?.type || null))
      .filter(Boolean);
    for (const fname of featureList) {
      counts.set(fname, (counts.get(fname) || 0) + 1);
    }
  }

  const arr = Array.from(counts.entries()).map(([feature, count]) => ({ feature, count }));
  const sorted = arr.sort((a, b) => b.count - a.count);
  const mostUsed = sorted.slice(0, limit);
  const leastUsed = sorted.slice(-limit).reverse();

  return { mostUsed, leastUsed };
}
