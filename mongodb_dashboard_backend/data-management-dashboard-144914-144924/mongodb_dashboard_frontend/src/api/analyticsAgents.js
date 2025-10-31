import { getApiClient } from './client';

// PUBLIC_INTERFACE
export async function getAgentsAggregation(params = {}) {
  /** Fetch default agents aggregation (by agent) */
  const api = getApiClient();
  const res = await api.get('/analytics/agents', { params });
  return res?.data || { items: [], total: 0, meta: null };
}

// PUBLIC_INTERFACE
export async function getDepartmentAggregation(params = {}) {
  /**
   * Fetch costs grouped by department.
   * Params may include: tenant_id, project_id, from, to, limit, offset.
   */
  const api = getApiClient();
  const merged = { grouping: 'department', ...params };
  const res = await api.get('/analytics/agents', { params: merged });
  return res?.data || { items: [], total: 0, meta: null };
}
