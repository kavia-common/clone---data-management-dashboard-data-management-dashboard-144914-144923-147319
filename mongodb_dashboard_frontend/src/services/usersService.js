import { listUsers } from "../api";

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
  // Delegates to the centralized API layer listUsers().
  // Any requestOpts such as AbortSignal are not used by listUsers currently, but retained for future compat.
  const { filter, page, limit, sort, search } = options || {};

  const params = {};
  if (page != null) params.page = page;
  if (limit != null) params.limit = limit;
  if (sort) params.sort = sort;
  if (search) {
    // Pass search under 'q' which backend supports for users or ignore if not supported.
    params.q = search;
  }

  if (filter) {
    params.filter = typeof filter === "string" ? filter : JSON.stringify(filter);
  }

  // listUsers returns normalized { items, total, meta }
  const res = await listUsers(params);
  return res;
}

// No default export to adhere to named exports convention
