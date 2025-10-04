import { getApiBaseUrl } from './util';

/**
 * PUBLIC_INTERFACE
 * getProjectLlmCost
 * Fetch total LLM cost for a project from the backend.
 * Returns shape: { projectId, cost, currency }
 */
export async function getProjectLlmCost(projectId) {
  if (!projectId) throw new Error('projectId is required');
  const base = getApiBaseUrl();
  const url = `${base}/projects/${encodeURIComponent(projectId)}/llm-cost`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch LLM cost (${res.status})`);
  }
  const data = await res.json();
  return data;
}

/**
 * PUBLIC_INTERFACE
 * getProjectCost
 * Fetch total project cost aggregated from session tracking (/api/projects/:projectId/cost).
 * Returns shape: { projectId, cost, currency }
 */
export async function getProjectCost(projectId) {
  if (!projectId) throw new Error('projectId is required');
  const base = getApiBaseUrl();
  const url = `${base}/projects/${encodeURIComponent(projectId)}/cost`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch project cost (${res.status})`);
  }
  return res.json();
}

/**
 * PUBLIC_INTERFACE
 * getProjectCostHistorySum
 * Fetch project cost aggregated from cost_history deltas (/api/projects/:projectId/cost-history-sum).
 * Returns shape: { projectId, cost }
 */
export async function getProjectCostHistorySum(projectId) {
  if (!projectId) throw new Error('projectId is required');
  const base = getApiBaseUrl();
  const url = `${base}/projects/${encodeURIComponent(projectId)}/cost-history-sum`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch project cost history sum (${res.status})`);
  }
  return res.json();
}

// Keep default export object if callers expect consolidated API
const api = { getProjectLlmCost, getProjectCost, getProjectCostHistorySum };
export default api;
