import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * getAgentById
 * Fetch an agent by ID. Returns null if the agent is not found (404) or if
 * the endpoint is not implemented on the backend yet.
 *
 * Usage:
 *   const agent = await getAgentById(agentId);
 *   if (!agent) { ... handle not found ... }
 */
export async function getAgentById(agentId) {
  if (!agentId) {
    throw new Error("getAgentById: agentId is required");
  }
  const api = getApiClient();
  try {
    console.debug("[agents.getAgentById] fetching", agentId);
    const res = await api.get(`/agents/${encodeURIComponent(String(agentId))}`);
    const data = res?.data?.data ?? res?.data ?? null;
    console.debug("[agents.getAgentById] fetched", { agentId, hasData: !!data });
    return data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      console.debug("[agents.getAgentById] 404 Not Found", agentId);
      return null;
    }
    console.debug("[agents.getAgentById] error", { agentId, message: err?.message });
    // If the endpoint does not exist yet, treat like "not available"
    if (status === 501 || status === 400 || status === 500 || status == null) {
      return null;
    }
    throw err;
  }
}
