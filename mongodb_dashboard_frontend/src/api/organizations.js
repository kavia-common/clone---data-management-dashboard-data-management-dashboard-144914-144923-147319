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

export default {
  listOrganizations,
};
