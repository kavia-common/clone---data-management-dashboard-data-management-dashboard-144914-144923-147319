import { getApiBaseUrl } from './util';

// PUBLIC_INTERFACE
export async function getProjectLlmCost(projectId) {
  /** Fetch total LLM cost for a project from the backend.
   * Returns shape: { projectId, cost, currency }
   */
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

// Keep default export object if callers expect consolidated API
const api = { getProjectLlmCost };
export default api;
