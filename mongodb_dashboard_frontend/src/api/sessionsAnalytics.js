import { getApiClient } from './client';
// Local helper for building query strings since ./util doesn't export it
function buildQueryString(params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach((item) => usp.append(k, String(item)));
    } else if (typeof v === 'object') {
      // Encode objects as JSON strings
      usp.append(k, JSON.stringify(v));
    } else {
      usp.append(k, String(v));
    }
  });
  return usp.toString();
}

/**
 * PUBLIC_INTERFACE
 * getDurationHistogram
 * Fetch session duration histogram data from the backend.
 *
 * Parameters:
 * - scope: 'all' | 'user' (determines whether to aggregate for all users or a specific user)
 * - userId: string | undefined (required if scope === 'user')
 * - tenantId: string | undefined (optional tenant/org scope)
 * - startDate: string | Date | undefined (ISO timestamp; defaults to 30 days ago)
 * - endDate: string | Date | undefined (ISO timestamp; defaults to now)
 * - binSizeMinutes: number (histogram bin size in minutes; default 10)
 *
 * Returns:
 * - On success: { bins: Array<{ start: number, end: number, count: number }>, meta?: any } or the raw backend payload.
 * - On failure: a safe fallback { bins: [], error: true, message?: string }
 */
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
  /** This function builds a GET request to /api/session-tracking/duration-histogram
   *  using existing api client utilities for base URL handling and GET.
   *  It applies defaults and minimal error handling.
   */

  // Default date range to the last 30 days if not supplied
  const now = new Date();
  const defaultEnd = now.toISOString();
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const toIso = (d) => {
    if (!d) return undefined;
    try {
      if (typeof d === 'string') return new Date(d).toISOString();
      if (d instanceof Date) return d.toISOString();
      return undefined;
    } catch (_) {
      return undefined;
    }
  };

  // Normalize potential alternate inputs from UI
  const effTenant = tenantId ?? tenant_id;
  const effUser = (scope === 'user' ? (userId ?? user_id) : undefined);
  const effStart = toIso(startDate) || (from ? toIso(from) : undefined) || defaultStart;
  const effEnd = toIso(endDate) || (to ? toIso(to) : undefined) || defaultEnd;
  const effBin = typeof binSizeMinutes === 'number' ? binSizeMinutes : (typeof bin_size_min === 'number' ? bin_size_min : 10);

  const params = {
    scope,
    tenant_id: effTenant, // follow snake_case commonly used in backend params
    user_id: effUser,
    start: effStart,
    end: effEnd,
    bin_size: effBin,
    unit: unit || 'minutes',
  };

  // Remove undefined params for a clean query string
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  const query = buildQueryString(cleanParams);
  const url = `/api/session-tracking/duration-histogram${query ? `?${query}` : ''}`;

  try {
    const res = await getApiClient().get(url);
    const payload = res?.data ?? res;

    // Basic validation: expect object with bins array, but pass through data if present
    if (payload && Array.isArray(payload.bins)) {
      return payload;
    }
    // Some backends may return { data: { bins: [...] } }
    if (payload && payload.data && Array.isArray(payload.data.bins)) {
      return payload.data;
    }
    // Fallback: try to coerce common shapes to our expected output
    if (Array.isArray(payload)) {
      return { bins: payload };
    }
    return { bins: [], meta: { raw: payload } };
  } catch (err) {
    // Minimal error handling with safe fallback
    // eslint-disable-next-line no-console
    console.error('getDurationHistogram failed:', err);
    return {
      bins: [],
      error: true,
      message: err?.message || 'Failed to load duration histogram',
    };
  }
}

export default {
  getDurationHistogram,
};
