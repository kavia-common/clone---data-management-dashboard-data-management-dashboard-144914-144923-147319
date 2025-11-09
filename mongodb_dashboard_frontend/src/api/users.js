import { getApiClient } from "./index";

/**
 * PUBLIC_INTERFACE
 * getUserProjects
 * Fetches a user's projects from session tracking using the backend endpoint:
 * GET /api/users/:userId/projects?organization_id={organizationId}&from={fromISO?}&to={toISO?}
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
  const { tenantId, organizationId, from, to } = params || {};
  // organizationId is optional now since the shared client appends organization_id automatically,
  // but if provided we still include it explicitly to override.
  const query = {};
  const effOrg = organizationId || tenantId;
  if (effOrg) query.organization_id = effOrg;
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

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[UsersAPI] GET /users/:id/projects", { userId, query });
  }
  const res = await api.get(`/users/${encodeURIComponent(userId)}/projects`, { params: query });
  // Response shape: { user_id, organization_id?, tenant_id?, projects: [{ project_id, project_name?, last_activity? }]}
  return res.data?.data ?? res.data;
}

/**
 * PUBLIC_INTERFACE
 * getUserBasic
 * Fetch minimal user info by MongoDB ObjectId.
 * GET /api/users/:id -> { id, name }
 *
 * @param {string} userId - MongoDB ObjectId as string
 * @returns {Promise<{ id: string, name: string|null }>}
 */
export async function getUserBasic(userId) {
  const api = getApiClient();
  if (!userId) throw new Error("userId is required");
  try {
    const res = await api.get(`/users/${encodeURIComponent(userId)}`);
    // Backend returns { id, name }
    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      // Not found: return a graceful minimal payload
      return { id: String(userId), name: null };
    }
    // Invalid ID or other failures should be handled by the caller for displaying 'Unknown user'
    throw err;
  }
}
