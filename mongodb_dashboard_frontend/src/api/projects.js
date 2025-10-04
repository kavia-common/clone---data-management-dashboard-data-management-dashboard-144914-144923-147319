import { getApiClient } from './client';

// PUBLIC_INTERFACE
export async function getProjectLlmCost(projectId) {
  /** Fetch total LLM cost for a project from the backend.
   * Returns shape: { projectId, cost, currency }
   */
  if (!projectId) throw new Error('projectId is required');
  const api = getApiClient();
  const res = await api.get(`/projects/${encodeURIComponent(projectId)}/llm-cost`);
  return res.data?.data ?? res.data;
}

/**
 * PUBLIC_INTERFACE
 * getProjectCostHistorySum
 * Calls GET /api/projects/:projectId/cost-history-sum
 * Returns: { projectId, cost }
 */
export async function getProjectCostHistorySum(projectId) {
  if (!projectId) throw new Error('projectId is required');
  const api = getApiClient();
  const res = await api.get(`/projects/${encodeURIComponent(projectId)}/cost-history-sum`);
  return res.data?.data ?? res.data;
}

/**
 * PUBLIC_INTERFACE
 * getProjectCost
 * Calls GET /api/projects/:projectId/cost
 * Returns: { projectId, cost, currency }
 */
export async function getProjectCost(projectId) {
  if (!projectId) throw new Error('projectId is required');
  const api = getApiClient();
  const res = await api.get(`/projects/${encodeURIComponent(projectId)}/cost`);
  return res.data?.data ?? res.data;
}

// Keep default export object if callers expect consolidated API
const api = { getProjectLlmCost, getProjectCostHistorySum, getProjectCost };
export default api;
