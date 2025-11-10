import { getApiClient } from "../api";

/**
 * PUBLIC_INTERFACE
 * getUsers
 * Retrieves users from the backend with support for filter, page, limit, and sort.
 *
 * Params:
 * - options?: {
 *     filter?: Record<string, any> | string,
 *     page?: number,
 *     limit?: number,
 *     sort?: string,
 *     search?: string
 *   }
 * - requestOpts?: { signal?: AbortSignal }
 *
 * Returns:
 * - { items: Array<any>, total: number, meta?: { page: number, limit: number, total: number } }
 */
export async function getUsers(options = {}, requestOpts = {}) {
  const api = getApiClient();
  const { filter, page, limit, sort, search } = options || {};

  const params = {};
  if (page != null) params.page = page;
  if (limit != null) params.limit = limit;
  if (sort) params.sort = sort;
  if (search) params.search = search;

  if (filter) {
    params.filter = typeof filter === "string" ? filter : JSON.stringify(filter);
  }

  const res = await api.get("/api/users", { params, ...(requestOpts || {}) });
  const payload = res?.data ?? res; // getApiClient returns { data }
  // Normalize both array and envelope shapes
  const items = Array.isArray(payload) ? payload : payload?.data || payload?.items || [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === "number" && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);

  return { items: Array.isArray(items) ? items : [], total, meta: payload?.meta || null };
}

export default { getUsers };
