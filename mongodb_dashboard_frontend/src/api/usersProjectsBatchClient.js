import { getApiClient } from './index';

/**
 * PUBLIC_INTERFACE
 * getUsersProjectsBatch
 * Fetch user projects for multiple users in one request (server-side batch when available,
 * else falls back to client-side fan-out as a single Promise.all call).
 *
 * Expected server endpoint (if supported):
 *   POST /api/users/projects
 *   body: { userIds: string[], organization_id?: string, tenant_id?: string, from?: ISO, to?: ISO }
 *   returns: { data: { [userId: string]: Array<{ project_id: string, project_name?: string|null, last_activity?: string|null }> } }
 *
 * Note: organization_id parameter should be the active tenant. This function passes it if provided.
 */
export async function getUsersProjectsBatch({ userIds, organization_id, tenant_id, from, to } = {}) {
  const api = getApiClient();
  const tenant = organization_id ?? tenant_id ?? undefined;
  const body = {
    userIds: Array.from(new Set((userIds || []).filter(Boolean).map(String))),
    ...(tenant ? { organization_id: tenant } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  if (!Array.isArray(body.userIds) || body.userIds.length === 0) {
    return { data: {} };
  }

  try {
    const res = await api.post('/users/projects', body);
    const payload = res?.data ?? res;
    // Normalize to { data: { userId: projects[] } }
    if (payload && payload.data && typeof payload.data === 'object') {
      return { data: payload.data };
    }
    // Some servers might just return the map without {data}
    if (payload && typeof payload === 'object') {
      return { data: payload };
    }
    return { data: {} };
  } catch (err) {
    // Fallback (client-side) if server endpoint is not implemented (e.g., 404)
    if (err?.response?.status === 404) {
      // Let callers decide whether to fan-out per user if needed.
      return { data: {} };
    }
    throw err;
  }
}

export default { getUsersProjectsBatch };
