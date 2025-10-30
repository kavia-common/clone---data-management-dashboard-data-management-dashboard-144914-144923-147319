import { getApiClient } from "./client";

/**
 * PUBLIC_INTERFACE
 * listOrganizations
 * Fetch list of organizations (tenants) for the current user.
 *
 * Calls:
 *  - GET /api/session/tenants
 *
 * Expects response.items: Array<{ id, name }>, but normalizes a few common variants.
 * Returns: Array<{ id: string, name: string|null }>
 */
export async function listOrganizations() {
  const api = getApiClient();
  try {
    const res = await api.get("/session/tenants");
    const data = res?.data;
    let items = [];

    if (Array.isArray(data)) {
      items = data.map((it) => {
        if (it && typeof it === "object") {
          const id =
            it.id ||
            it.tenant_id ||
            it.tenantId ||
            it._id ||
            it.organization_id ||
            it.org_id ||
            String(it);
          const name =
            it.name ||
            it.tenant_name ||
            it.tenantName ||
            it.organization_name ||
            it.org_name ||
            null;
          return { id: String(id), name: name != null ? String(name) : null };
        }
        return { id: String(it), name: null };
      });
    } else if (data && typeof data === "object") {
      const arr = Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.data)
        ? data.data
        : [];
      items = arr.map((it) => {
        if (it && typeof it === "object") {
          const id =
            it.id ||
            it.tenant_id ||
            it.tenantId ||
            it._id ||
            it.organization_id ||
            it.org_id ||
            String(it);
          const name =
            it.name ||
            it.tenant_name ||
            it.tenantName ||
            it.organization_name ||
            it.org_name ||
            null;
          return { id: String(id), name: name != null ? String(name) : null };
        }
        return { id: String(it), name: null };
      });
    } else {
      items = [];
    }

    // Sort by name then id
    items.sort((a, b) => {
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an && bn && an !== bn) return an < bn ? -1 : 1;
      return (a.id || "").localeCompare(b.id || "");
    });

    return items;
  } catch (err) {
    throw new Error(err?.message || "Failed to load organizations");
  }
}

/**
 * PUBLIC_INTERFACE
 * getOrganizationSummary
 * Build summary for a tenant with:
 *  - id
 *  - name (best-effort; may fetch navigation if not available)
 *  - totalCost (sum of users[].total_cost)
 *  - usersCount (users.length)
 *
 * Calls:
 *  - GET /api/tenants/:tenantId/users/usage -> { users: [...] } or { items: [...] }
 *  - Optionally GET /api/tenants/:tenantId/navigation to derive tenant_name
 *
 * @param {string} tenantId
 * @returns {Promise<{ id: string, name: string|null, totalCost: number, usersCount: number }>}
 */
export async function getOrganizationSummary(tenantId) {
  const api = getApiClient();
  if (!tenantId) throw new Error("tenantId is required");
  try {
    const res = await api.get(`/tenants/${encodeURIComponent(tenantId)}/users/usage`);
    const payload = res?.data || {};
    // Expected shape: { users: [...] }
    const users = Array.isArray(payload.users)
      ? payload.users
      : Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload)
      ? payload
      : [];

    let totalCost = 0;
    for (const u of users) {
      const n = Number(
        (u && (u.total_cost ?? u.totalCost ?? u.usd ?? u.amount_usd ?? u.amountUSD ?? u.cost)) || 0
      );
      if (Number.isFinite(n)) totalCost += n;
    }

    // Try to fetch tenant_name if not available
    let name = null;
    try {
      const nav = await api.get(`/tenants/${encodeURIComponent(tenantId)}/navigation`);
      name =
        nav?.data?.tenant_name ??
        nav?.data?.tenantName ??
        null;
    } catch {
      // ignore name fetch errors
    }

    return {
      id: String(tenantId),
      name,
      totalCost: Number.isFinite(totalCost) ? totalCost : 0,
      usersCount: users.length || 0,
    };
  } catch (err) {
    throw new Error(err?.message || "Failed to load organization summary");
  }
}

export default {
  listOrganizations,
  getOrganizationSummary,
};
