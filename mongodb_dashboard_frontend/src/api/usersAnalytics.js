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

/**
 * PUBLIC_INTERFACE
 * getDailyActiveUsers
 * GET /api/users/analytics/daily-active?days=30
 */
export async function getDailyActiveUsers(params = { days: 30 }) {
  const base = getApiBase();
  const url = `${base}/users/analytics/daily-active`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getUsersByDepartment
 * GET /api/users/analytics/by-department?windowDays=14
 */
export async function getUsersByDepartment(params = { windowDays: 14 }) {
  const base = getApiBase();
  const url = `${base}/users/analytics/by-department`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getDepartmentsFilterOptions
 * GET /api/users/analytics/filters/departments
 * Returns array of distinct department strings.
 */
export async function getDepartmentsFilterOptions() {
  const base = getApiBase();
  const url = `${base}/users/analytics/filters/departments`;
  const res = await axios.get(url);
  const data = res?.data;
  return Array.isArray(data) ? data : [];
}

/**
 * PUBLIC_INTERFACE
 * getOrganizationsFilterOptions
 * GET /api/users/analytics/filters/organizations
 * Returns array of distinct organization_id strings.
 */
export async function getOrganizationsFilterOptions() {
  const base = getApiBase();
  const url = `${base}/users/analytics/filters/organizations`;
  const res = await axios.get(url);
  const data = res?.data;
  return Array.isArray(data) ? data : [];
}

/**
 * PUBLIC_INTERFACE
 * getActiveVsInactive
 * GET /api/users/analytics/active-vs-inactive?windowDays=14
 */
export async function getActiveVsInactive(params = { windowDays: 14 }) {
  const base = getApiBase();
  const url = `${base}/users/analytics/active-vs-inactive`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getTopActiveUsers
 * GET /api/users/analytics/top-active?limit=10&windowDays=30
 */
export async function getTopActiveUsers(params = { limit: 10, windowDays: 30 }) {
  const base = getApiBase();
  const url = `${base}/users/analytics/top-active`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getUsersAnalyticsSummary
 * GET /api/users/analytics/summary
 * Returns KPIs for the Users Analytics page.
 */
export async function getUsersAnalyticsSummary() {
  const base = getApiBase();
  const url = `${base}/users/analytics/summary`;
  const res = await axios.get(url);
  return res.data;
}

export default {
  getActiveUsersTrend,
  getTenantUsersSummary,
  getDailyActiveUsers,
  getUsersByDepartment,
  getActiveVsInactive,
  getTopActiveUsers,
  getUsersAnalyticsSummary,
  getDepartmentsFilterOptions,
  getOrganizationsFilterOptions,
};
