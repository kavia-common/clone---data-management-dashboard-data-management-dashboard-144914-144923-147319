import { getApiClient } from './client';

/**
 * Local helper to build a clean query object by:
 * - Converting Date instances to ISO strings
 * - Dropping undefined/null/empty string values
 */
function normalizeQuery(params = {}) {
  const toIso = (d) => {
    try {
      if (d instanceof Date) return d.toISOString();
      if (typeof d === 'string') return new Date(d).toISOString();
    } catch (_) {
      // fallthrough to return string value below
    }
    return typeof d === 'string' ? d : undefined;
  };

  const out = {};
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;

    if (k === 'from' || k === 'to') {
      const iso = toIso(v);
      if (iso) out[k] = iso;
      return;
    }

    if (k === 'includeInactive') {
      // Ensure boolean is sent as boolean/string "true"/"false" depending on axios/qs handling
      out[k] = Boolean(v);
      return;
    }

    out[k] = v;
  });
  return out;
}

/**
 * PUBLIC_INTERFACE
 * getTenantUsersSummary
 * Calls GET /api/users/tenant-summary with optional query params to fetch
 * the aggregated tenant-wise distinct user counts.
 *
 * Parameters (all optional):
 * - from: string | Date (ISO lower bound)
 * - to: string | Date (ISO upper bound)
 * - status: string (session status filter; backend default "completed|active")
 * - includeInactive: boolean (include tenants without recent activity)
 *
 * Returns:
 * - On success: { items: Array<{ tenant_id: string, tenant_name?: string|null, user_count: number }>, total: number }
 * - On failure: throws an Error with context; logs the error to console and includes server message when available.
 */
export async function getTenantUsersSummary(params = {}) {
  const api = getApiClient();
  const query = normalizeQuery(params);

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[UsersAnalytics] GET /users/tenant-summary', query);
  }

  try {
    const res = await api.get('/users/tenant-summary', { params: query });
    const payload = res?.data ?? {};

    // Normalize expected shape: { items: [...], total: number }
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const total =
      typeof payload?.total === 'number'
        ? payload.total
        : (Array.isArray(items) ? items.length : 0);

    return { items, total };
  } catch (err) {
    const status = err?.response?.status;
    const serverMsg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message;

    // eslint-disable-next-line no-console
    console.error('[UsersAnalytics] Failed to fetch tenant users summary', {
      status,
      message: serverMsg,
    });

    // For 404 or 400, return an empty result to avoid hard failure in UI flows
    if (status === 404 || status === 400) {
      return { items: [], total: 0 };
    }

    // Re-throw for unexpected errors so callers may decide how to handle
    throw new Error(serverMsg || 'Failed to fetch tenant users summary');
  }
}

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Calls GET /api/users/active-trend to fetch time-bucketed distinct active users.
 *
 * Parameters (all optional):
 * - from: string | Date (ISO)
 * - to: string | Date (ISO)
 * - granularity: 'day' | 'week' (default handled by backend)
 * - status: string (default handled by backend)
 * - tenant_id: string (optional scope)
 *
 * Returns:
 * - On success: { items: Array<{ date: string, total: number }>, meta?: object }
 * - On failure: throws Error; returns { items: [] } for 400/404 to keep UI resilient.
 */
export async function getActiveUsersTrend(params = {}) {
  const api = getApiClient();
  const query = normalizeQuery(params);

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[UsersAnalytics] GET /users/active-trend', query);
  }

  try {
    const res = await api.get('/users/active-trend', { params: query });
    const payload = res?.data ?? {};
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const meta = payload?.meta || null;
    return { items, meta };
  } catch (err) {
    const status = err?.response?.status;
    const serverMsg =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message;

    // eslint-disable-next-line no-console
    console.error('[UsersAnalytics] Failed to fetch active users trend', {
      status,
      message: serverMsg,
    });

    if (status === 404 || status === 400) {
      return { items: [], meta: null };
    }
    throw new Error(serverMsg || 'Failed to fetch active users trend');
  }
}

export default {
  getTenantUsersSummary,
  getActiveUsersTrend,
};
