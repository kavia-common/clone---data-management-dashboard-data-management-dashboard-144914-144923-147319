import client from './client';
import { buildOverviewQueryParams } from './buildOverviewFilterParams';

/**
 * PUBLIC_INTERFACE
 * getOverviewTotals
 * Fetch totals for overview dashboard. Currently no filters required but params accepted for forward compatibility.
 */
export async function getOverviewTotals(params = {}) {
  const res = await client.get('/api/dashboard/overview/metrics', { params });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getCostsOverTime
 * Disabled direct call to failing endpoint (/api/analytics/llm-costs/over-time).
 * Use new llmCostsAnalytics.getLlmCostsOverTime from src/api/llmCostsAnalytics.js in consumers instead.
 * This function now returns a safe placeholder to avoid breaking imports.
 */
export async function getCostsOverTime(_filter = {}) {
  return { labels: [], datasets: [{ label: 'Total Cost', data: [] }], meta: {} };
}

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Disabled direct call to failing endpoint (/api/analytics/users/active-trend).
 * Use usersActiveTrend.getActiveUsersTrend (src/api/usersActiveTrend.js) in consumers instead.
 * This function now returns a safe placeholder to avoid breaking imports.
 */
export async function getActiveUsersTrend(_filter = {}) {
  return { items: [], meta: {} };
}

/**
 * PUBLIC_INTERFACE
 * getNewUsersOverTime
 * Fetch new users over time with optional filters: { start, end, granularity, organization_id|tenantId }
 * Note: backend expects start/end for this endpoint.
 */
export async function getNewUsersOverTime(filter = {}) {
  const res = await client.get('/api/analytics/users/new-over-time', {
    params: buildOverviewQueryParams(filter, { useStartEnd: true }),
  });
  return res.data;
}
