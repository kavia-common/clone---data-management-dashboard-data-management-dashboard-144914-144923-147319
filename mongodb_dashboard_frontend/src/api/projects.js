import { getApiClient } from './index';

/**
 * PUBLIC_INTERFACE
 * getProjectCost
 * Fetch the aggregated cost for a project from the backend.
 * Calls GET /api/projects/:projectId/cost and returns { projectId, cost, currency }.
 */
export async function getProjectCost(projectId) {
  if (!projectId) {
    throw new Error('getProjectCost: projectId is required');
  }
  const api = getApiClient();
  const res = await api.get(`/projects/${encodeURIComponent(String(projectId))}/cost`);
  const json = res.data?.data ?? res.data;
  return {
    projectId: json?.projectId ?? String(projectId),
    cost: Number(json?.cost ?? 0),
    currency: json?.currency || 'USD',
  };
}

/**
 * PUBLIC_INTERFACE
 * getProjectCostHistorySum
 * Fetch the project's total cost aggregated from session_tracking cost_history deltas.
 * Calls GET /api/projects/:projectId/cost-history-sum and returns { projectId, cost }.
 * This supersedes naive total_cost summation as it accounts for granular deltas.
 */
export async function getProjectCostHistorySum(projectId) {
  if (!projectId) {
    throw new Error('getProjectCostHistorySum: projectId is required');
  }
  const api = getApiClient();
  const res = await api.get(`/projects/${encodeURIComponent(String(projectId))}/cost-history-sum`);
  const json = res.data?.data ?? res.data;
  return {
    projectId: json?.projectId ?? String(projectId),
    cost: Number(json?.cost ?? 0),
  };
}




