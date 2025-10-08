import { get } from './client';
import { buildQueryString } from './util';

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

  const params = {
    scope,
    tenant_id: tenantId, // follow snake_case commonly used in backend params
    user_id: scope === 'user' ? userId : undefined,
    start: toIso(startDate) || defaultStart,
    end: toIso(endDate) || defaultEnd,
    bin_size: typeof binSizeMinutes === 'number' ? binSizeMinutes : 10,
  };

  // Remove undefined params for a clean query string
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );

  const query = buildQueryString(cleanParams);
  const url = `/api/session-tracking/duration-histogram${query ? `?${query}` : ''}`;

  try {
    const res = await get(url);
    // Basic validation: expect object with bins array, but pass through data if present
    if (res && Array.isArray(res.bins)) {
      return res;
    }
    // Some backends may return { data: [...] }
    if (res && res.data && Array.isArray(res.data.bins)) {
      return res.data;
    }
    // Fallback: try to coerce common shapes to our expected output
    if (Array.isArray(res)) {
      return { bins: res };
    }
    return { bins: [], meta: { raw: res } };
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
