import { getApiClient } from './client';

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
