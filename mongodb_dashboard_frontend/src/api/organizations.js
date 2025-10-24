import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * listOrganizations
 * Fetch a list of organizations (tenants) authorized for the current user.
 *
 * Attempts the following endpoints:
 *  - GET /api/session/tenants           (preferred; requires Authorization)
 *  - TODO: GET /api/organizations       (not yet available)
 *
 * Returns normalized items in the shape:
 *  - [{ id: string, name?: string|null }]
 */
export async function listOrganizations() {
  const api = getApiClient();

  // Preferred endpoint based on backend openapi: /api/session/tenants
  // Expected shapes can vary; we normalize to { id, name }
  try {
    const res = await api.get("/session/tenants");
    const data = res?.data;
    let items = [];

    // Handle various possible payloads:
    // 1) Array<string|object>
    if (Array.isArray(data)) {
      items = data.map((it) => {
        if (it && typeof it === "object") {
          const id = it.tenant_id || it.tenantId || it.id || it._id || it.organization_id || it.org_id || String(it);
          const name = it.tenant_name || it.tenantName || it.name || it.organization_name || it.org_name || null;
          return { id: String(id), name: name != null ? String(name) : null };
        }
        return { id: String(it), name: null };
      });
    } else if (data && typeof data === "object") {
      // 2) Object with items key
      const arr = Array.isArray(data.items) ? data.items : Array.isArray(data.data) ? data.data : [];
      items = arr.map((it) => {
        if (it && typeof it === "object") {
          const id = it.tenant_id || it.tenantId || it.id || it._id || it.organization_id || it.org_id || String(it);
          const name = it.tenant_name || it.tenantName || it.name || it.organization_name || it.org_name || null;
          return { id: String(id), name: name != null ? String(name) : null };
        }
        return { id: String(it), name: null };
      });
    } else {
      items = [];
    }

    // Sort by name then id for better UX (stable)
    items.sort((a, b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an && bn && an !== bn) return an < bn ? -1 : 1;
      return (a.id || "").localeCompare(b.id || "");
    });

    return items;
  } catch (err) {
    // Fallback NOTE:
    // TODO: Add GET /api/organizations when backend provides it.
    throw new Error(err?.message || "Failed to load organizations");
  }
}

/**
 * PUBLIC_INTERFACE
 * getOrganizationSummary
 * Aggregates a tenant's usage to produce an organization summary with:
 *  - organizationId
 *  - organizationName (optional; pass through from the caller if known)
 *  - totalCost (sum of user usage costs where available)
 *  - users (distinct user count or number of rows)
 *
 * Implementation:
 *  - GET /api/tenants/{tenantId}/users/usage
 *    We compute totalCost by summing common cost fields per user entry:
 *      total_cost | totalCost | usd | amount_usd | amountUSD | cost
 *    Users count: number of distinct user_id fields; fallback to array length.
 *
 * @param {string} tenantId
 * @returns {Promise<{ organizationId: string, organizationName: string|null, totalCost: number, users: number }>}
 */
export async function getOrganizationSummary(tenantId) {
  const api = getApiClient();
  if (!tenantId) {
    throw new Error("tenantId is required");
  }
  try {
    const res = await api.get(`/tenants/${encodeURIComponent(tenantId)}/users/usage`);
    const data = res?.data;

    const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    let totalCost = 0;
    const userIds = new Set();

    for (const row of items) {
      if (row && typeof row === "object") {
        const uid = row.user_id || row.userId || row.id || row._id;
        if (uid != null) userIds.add(String(uid));
        // Flexible cost fields aggregation
        const cand = [
          row.total_cost,
          row.totalCost,
          row.usd,
          row.amount_usd,
          row.amountUSD,
          row.cost,
        ];
        for (const c of cand) {
          const n = Number(c);
          if (Number.isFinite(n)) {
            totalCost += n;
            break;
          }
        }
      }
    }

    return {
      organizationId: String(tenantId),
      organizationName: null, // caller can overwrite if they have display name
      totalCost: Number.isFinite(totalCost) ? totalCost : 0,
      users: userIds.size || items.length || 0,
    };
  } catch (err) {
    // Surface a controlled message
    throw new Error(err?.message || "Failed to load organization summary");
  }
}

export default {
  listOrganizations,
  getOrganizationSummary,
};
