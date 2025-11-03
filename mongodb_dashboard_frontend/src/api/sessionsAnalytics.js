import api from '../utils/api';

/** Helper: Convert any date-like input to ISO string or undefined */
function toIsoOrUndefined(d) {
  if (!d) return undefined;
  try {
    const date = new Date(d);
    return isNaN(date.getTime()) ? undefined : date.toISOString();
  } catch {
    return undefined;
  }
}

/**
 * PUBLIC_INTERFACE
 * getDurationHistogram
 * Fetches session duration histogram directly from backend database.
 *
 * Params:
 * - { from?: string, to?: string, tenant_id?: string, user_id?: string, bin_size?: number }
 * Returns:
 *   { bins: Array<{ start: number, end: number, count: number }>, meta?: any }
 */
export async function getDurationHistogram({
  from,
  to,
  tenant_id,
  user_id,
  bin_size = 10,
  unit = 'minutes',
} = {}) {
  try {
    const params = new URLSearchParams();
    const start = toIsoOrUndefined(from);
    const end = toIsoOrUndefined(to);

    if (start) params.set('from', start);
    if (end) params.set('to', end);
    if (tenant_id) params.set('tenant_id', tenant_id);
    if (user_id) params.set('user_id', user_id);
    if (bin_size) params.set('bin_size', String(bin_size));
    if (unit) params.set('unit', unit);

    // ✅ Call the DB-backed analytics API
    const res = await api.get(`/api/sessions-analytics/duration-histogram?${params.toString()}`);

    if (!res?.data) {
      console.warn('[getDurationHistogram] Empty response');
      return { bins: [] };
    }

    // ✅ Normalize response shapes
    const data = res.data;
    if (Array.isArray(data.bins)) return data;
    if (Array.isArray(data?.data?.bins)) return data.data;
    if (Array.isArray(data)) return { bins: data };
    return { bins: [], meta: { raw: data } };
  } catch (error) {
    console.error('[getDurationHistogram] Failed to fetch:', error);
    return { bins: [], error: true, message: error?.message || 'Failed to load duration histogram' };
  }
}

export default { getDurationHistogram };
