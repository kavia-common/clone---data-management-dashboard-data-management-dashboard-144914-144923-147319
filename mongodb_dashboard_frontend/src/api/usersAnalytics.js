import { getApiClient } from './baseClient';
import axios from 'axios';
import { getApiBase } from './config';

/**
 * INTERNAL: Prefer fetch-based apiClient when path starts with /api. Some existing code uses axios with absolute URLs.
 */
function http() {
  const client = getApiClient();
  return {
    get: (path, options = {}) => client.get(path, options),
  };
}

/**
 * PUBLIC_INTERFACE
 * fetchUsersAnalyticsFilters
 * Retrieves available filter values for users analytics: organizations and departments.
 */
export async function fetchUsersAnalyticsFilters() {
  const client = http();
  const [orgsRes, deptsRes] = await Promise.all([
    client.get('/api/users/analytics/filters/organizations'),
    client.get('/api/users/analytics/filters/departments'),
  ]);
  return {
    organizations: orgsRes.data || [],
    departments: deptsRes.data || [],
  };
}

/**
 * PUBLIC_INTERFACE
 * fetchDailyActiveUsers
 * Fetches Daily Active Users time series with optional filters and date range.
 */
export async function fetchDailyActiveUsers(params = {}) {
  const client = http();
  const res = await client.get('/api/users/analytics/daily-active', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * fetchActiveVsInactive
 * Fetches active vs inactive user counts with optional filters and date range.
 */
export async function fetchActiveVsInactive(params = {}) {
  const client = http();
  const res = await client.get('/api/users/analytics/active-vs-inactive', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * fetchUsersByDepartment
 * Fetches active users grouped by department with optional filters and date range.
 */
export async function fetchUsersByDepartment(params = {}) {
  const client = http();
  const res = await client.get('/api/users/analytics/by-department', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * fetchTopActiveUsers
 * Fetches top active users list by most recent activity with optional filters and date range.
 */
export async function fetchTopActiveUsers(params = {}) {
  const client = http();
  const res = await client.get('/api/users/analytics/top-active', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * fetchUsersSummary
 * Fetches KPI summary values (totalActive, newUsersThisWeek, inactive30Days, compliancePct, WAU, MAU).
 */
export async function fetchUsersSummary(params = {}) {
  const client = http();
  const res = await client.get('/api/users/analytics/summary', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Backwards compatibility export for other parts using axios + config base (unchanged).
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
 * Backwards compatibility export.
 */
export async function getTenantUsersSummary(params = {}) {
  const base = getApiBase();
  const url = `${base}/users/tenant-summary`;
  const res = await axios.get(url, { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getUsersAnalyticsSummary (legacy alias)
 */
export async function getUsersAnalyticsSummary(params = {}) {
  return fetchUsersSummary(params);
}

/**
 * PUBLIC_INTERFACE
 * getDailyActiveUsers (legacy alias)
 */
export async function getDailyActiveUsers(params = {}) {
  return fetchDailyActiveUsers(params);
}

/**
 * PUBLIC_INTERFACE
 * getActiveVsInactive (legacy alias)
 */
export async function getActiveVsInactive(params = {}) {
  return fetchActiveVsInactive(params);
}

/**
 * PUBLIC_INTERFACE
 * getUsersByDepartment (legacy alias)
 */
export async function getUsersByDepartment(params = {}) {
  return fetchUsersByDepartment(params);
}

/**
 * PUBLIC_INTERFACE
 * getTopActiveUsers (legacy alias)
 */
export async function getTopActiveUsers(params = {}) {
  return fetchTopActiveUsers(params);
}

/**
 * PUBLIC_INTERFACE
 * getDepartmentsFilterOptions
 */
export async function getDepartmentsFilterOptions() {
  const client = http();
  const res = await client.get('/api/users/analytics/filters/departments');
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * PUBLIC_INTERFACE
 * getOrganizationsFilterOptions
 */
export async function getOrganizationsFilterOptions() {
  const client = http();
  const res = await client.get('/api/users/analytics/filters/organizations');
  return Array.isArray(res.data) ? res.data : [];
}

export default {
  fetchUsersAnalyticsFilters,
  fetchDailyActiveUsers,
  fetchActiveVsInactive,
  fetchUsersByDepartment,
  fetchTopActiveUsers,
  fetchUsersSummary,
  getActiveUsersTrend,
  getTenantUsersSummary,
  getUsersAnalyticsSummary,
  getDailyActiveUsers,
  getActiveVsInactive,
  getUsersByDepartment,
  getTopActiveUsers,
  getDepartmentsFilterOptions,
  getOrganizationsFilterOptions,
};
