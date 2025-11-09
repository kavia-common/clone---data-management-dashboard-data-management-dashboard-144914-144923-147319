import { getApiClient } from './index';

// PUBLIC_INTERFACE
export async function getDurationHistogram({
  scope = 'all',
  userId,
  tenantId,
  startDate,
  endDate,
  binSizeMinutes = 10,
  // Backwards-compat alternative keys the UI might pass:
  tenant_id,
  user_id,
  from,
  to,
  bin_size_min,
  unit,
} = {}) {
  /** Build a GET to /api/session-tracking/duration-histogram using shared client (which appends tenant_id when needed).
   *  Avoid passing organization_id; rely on tenant_id only for this module.
   */

  const now = new Date();
  const defaultEnd = now.toISOString();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const toIso = (d) => {
    if (!d) return undefined;
    try {
      if (typeof d === 'string') return new Date(d).toISOString();
      if (d instanceof Date) return d.toISOString();
      return undefined;
    } catch {
      return undefined;
    }
  };

  // Normalize inputs
  const effTenant = tenantId ?? tenant_id; // do not accept organization_id here
  const effUser = (scope === 'user' ? (userId ?? user_id) : undefined);
  const effStart = toIso(startDate) || (from ? toIso(from) : undefined) || defaultStart;
  const effEnd = toIso(endDate) || (to ? toIso(to) : undefined) || defaultEnd;
  const effBin = typeof binSizeMinutes === 'number' ? binSizeMinutes : (typeof bin_size_min === 'number' ? bin_size_min : 10);

  // Let the shared client append tenant_id for base /api/session-tracking calls.
  // For this analytics sub-endpoint, include tenant_id only if explicitly provided (it will be merged safely).
  const params = {
    scope,
    ...(effTenant ? { tenant_id: effTenant } : {}),
    ...(effUser ? { user_id: effUser } : {}),
    start: effStart,
    end: effEnd,
    bin_size: effBin,
    unit: unit || 'minutes',
  };

  try {
    const res = await getApiClient().get('/api/session-tracking/duration-histogram', { params });
    const payload = res?.data ?? res;
    if (payload && Array.isArray(payload.bins)) return payload;
    if (payload && payload.data && Array.isArray(payload.data.bins)) return payload.data;
    if (Array.isArray(payload)) return { bins: payload };
    return { bins: [], meta: { raw: payload } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sessionsAnalytics] getDurationHistogram failed (tenant_id path):', err);
    return { bins: [], error: true, message: err?.message || 'Failed to load duration histogram' };
  }
}

export default { getDurationHistogram };
