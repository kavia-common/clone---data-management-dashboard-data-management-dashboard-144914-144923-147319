import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * getUserProjects
 * Fetches a user's projects from session tracking using the backend endpoint:
 * GET /api/users/:userId/projects?tenant_id={tenantId}&from={fromISO?}&to={toISO?}
 *
 * @param {string} userId - The user identifier.
 * @param {{ tenantId: string, from?: string|Date|null, to?: string|Date|null }} params - Query parameters.
 * @returns {Promise<{ user_id: string, tenant_id: string, projects: Array<{ project_id: string, project_name?: string|null, last_activity?: string|null }> }>}
 */
export async function getUserProjects(userId, params = {}) {
  const api = getApiClient();
  if (!userId) {
    throw new Error("userId is required");
  }
  const { tenantId, from, to } = params || {};
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const query = {
    tenant_id: tenantId,
  };
  // Normalize from/to to ISO if Date provided
  if (from) {
    try {
      query.from = typeof from === "string" ? from : new Date(from).toISOString();
    } catch {
      // ignore invalid date; backend will handle if sent
      query.from = String(from);
    }
  }
  if (to) {
    try {
      query.to = typeof to === "string" ? to : new Date(to).toISOString();
    } catch {
      query.to = String(to);
    }
  }

  const res = await api.get(`/users/${encodeURIComponent(userId)}/projects`, { params: query });
  // Response shape: { user_id, tenant_id, projects: [{ project_id, project_name?, last_activity? }]}
  return res.data?.data ?? res.data;
}
