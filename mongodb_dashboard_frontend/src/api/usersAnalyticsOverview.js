import { getApiBase } from "./config";
import { buildQueryString } from "./util";

/**
 * Users Analytics API client for overview metrics and related charts.
 * All functions accept an optional params object, and include organization_id when provided.
 * Endpoints consumed:
 *  - GET /api/users/analytics/overview
 *  - GET /api/users/analytics/daily-active
 *  - GET /api/users/analytics/by-department
 *  - GET /api/users/analytics/active-vs-inactive
 *  - GET /api/users/analytics/top-active
 */

// PUBLIC_INTERFACE
export async function fetchUsersAnalyticsOverview(params = {}) {
  /** Fetches overview KPI metrics for users analytics. Returns JSON object with KPI fields. */
  const qs = buildQueryString(params);
  const res = await fetch(`${getApiBase()}/users/analytics/overview${qs}`);
  if (!res.ok) throw new Error(`Overview fetch failed: ${res.status}`);
  return res.json();
}

// PUBLIC_INTERFACE
export async function fetchDailyActiveUsers(params = {}) {
  /** Fetches Daily Active Users time series. Expected fields: [{ date|bucket, count|total }] */
  const qs = buildQueryString(params);
  const res = await fetch(`${getApiBase()}/users/analytics/daily-active${qs}`);
  if (!res.ok) throw new Error(`Daily active fetch failed: ${res.status}`);
  return res.json();
}

// PUBLIC_INTERFACE
export async function fetchByDepartment(params = {}) {
  /** Fetches active users grouped by department. Expected fields: array of { department, count } */
  const qs = buildQueryString(params);
  const res = await fetch(`${getApiBase()}/users/analytics/by-department${qs}`);
  if (!res.ok) throw new Error(`By department fetch failed: ${res.status}`);
  return res.json();
}

// PUBLIC_INTERFACE
export async function fetchActiveVsInactive(params = {}) {
  /** Fetches active vs inactive users counts. Expected fields: { active, inactive } */
  const qs = buildQueryString(params);
  const res = await fetch(`${getApiBase()}/users/analytics/active-vs-inactive${qs}`);
  if (!res.ok) throw new Error(`Active vs inactive fetch failed: ${res.status}`);
  return res.json();
}

// PUBLIC_INTERFACE
export async function fetchTopActiveUsers(params = {}) {
  /** Fetches top active users list. Expected array of users with fields like name/email/department/lastActive/activityScore */
  const qs = buildQueryString(params);
  const res = await fetch(`${getApiBase()}/users/analytics/top-active${qs}`);
  if (!res.ok) throw new Error(`Top active users fetch failed: ${res.status}`);
  return res.json();
}
