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
 * Fetch LLM costs over time with optional filters: { from, to, granularity, organization_id|tenantId }
 */
export async function getCostsOverTime(filter = {}) {
  const res = await client.get('/api/analytics/llm-costs/over-time', {
    params: buildOverviewQueryParams(filter, { useStartEnd: false }),
  });
  return res.data;
}

/**
 * PUBLIC_INTERFACE
 * getActiveUsersTrend
 * Fetch active users trend with optional filters: { from, to, granularity, organization_id|tenantId, status? }
 */
export async function getActiveUsersTrend(filter = {}) {
  const res = await client.get('/api/analytics/users/active-trend', {
    params: buildOverviewQueryParams(filter, { useStartEnd: false }),
  });
  return res.data;
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
