import axios from "axios";
import { getApiBase } from "./config";

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users trend from backend.
 * @param {{ from?: string, to?: string, status?: string, tenant_id?: string, granularity?: 'day'|'week'|'month' }} params
 * @returns {Promise<{ items: Array<{ date: string, total: number }>, meta?: any }>}
 */
export async function getActiveUsersTrend(params = {}) {
  const base = getApiBase();
  const url = `${base}/users/active-trend`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getTenantUsersSummary
 * Fetch aggregated users by tenant summary.
 *
 * Parameters:
 * - from?: string (ISO) - optional start date-time
 * - to?: string (ISO) - optional end date-time
 * - status?: string - optional status filter (default handled by backend)
 * - includeInactive?: boolean - whether to include inactive tenants
 *
 * Returns a normalized payload:
 * - { items: Array<{ tenant_id: string, tenant_name?: string|null, user_count: number }>, total?: number }
 *   or raw array fallback if backend returns array.
 *
 * Notes:
 * - Backend endpoint: GET /api/users/tenant-summary
 */
export async function getTenantUsersSummary(params = {}) {
  const base = getApiBase();
  const url = `${base}/users/tenant-summary`;
  try {
    const res = await axios.get(url, { params });
    const data = res?.data ?? res;

    // Normalize shapes:
    if (data && Array.isArray(data.items)) {
      return { items: data.items, total: data.total ?? data.items.length };
    }
    if (Array.isArray(data)) {
      return { items: data, total: data.length };
    }
    // Pass-through minimal object
    if (data && typeof data === "object") {
      const items = Array.isArray(data.data) ? data.data : Array.isArray(data.items) ? data.items : [];
      return { items, total: data.total ?? items.length ?? 0 };
    }
    return { items: [], total: 0 };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[UsersAnalyticsAPI] getTenantUsersSummary failed:", err);
    // Surface a controlled error message; caller can show a toast or inline error
    throw new Error(err?.message || "Failed to load tenant users summary");
  }
}

export default { getActiveUsersTrend, getTenantUsersSummary };
