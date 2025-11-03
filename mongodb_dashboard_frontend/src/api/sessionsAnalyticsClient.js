import api from '../utils/api';

/** Helper to convert date input to ISO string */
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
 * fetchActiveUsersTrend
 * Fetches active user trends directly from DB via analytics API.
 * Supports date range, granularity, tenant_id, etc.
 */
export async function fetchActiveUsersTrend({
  startDate,
  endDate,
  from,
  to,
  granularity = 'day',
  tenant_id,
  status,
} = {}) {
  try {
    const params = new URLSearchParams();
    const start = toIsoOrUndefined(startDate || from);
    const end = toIsoOrUndefined(endDate || to);

    if (start) params.set('from', start);
    if (end) params.set('to', end);
    if (tenant_id) params.set('tenant_id', tenant_id);
    if (status) params.set('status', status);
    if (granularity) params.set('granularity', granularity);

    // ✅ Unified DB-backed analytics endpoint
    const res = await api.get(`/api/sessions-analytics/active-users-trend?${params.toString()}`);

    if (!res?.data) {
      console.warn('[fetchActiveUsersTrend] Empty response');
      return { trend: [] };
    }

    const data = res.data;
    if (Array.isArray(data.trend)) return data;
    if (Array.isArray(data?.data?.trend)) return data.data;
    if (Array.isArray(data)) return { trend: data };
    return { trend: [], meta: { raw: data } };
  } catch (error) {
    console.error('[fetchActiveUsersTrend] Failed to fetch:', error);
    return { trend: [], error: true, message: error?.message || 'Failed to load active users trend' };
  }
}

export default { fetchActiveUsersTrend };
