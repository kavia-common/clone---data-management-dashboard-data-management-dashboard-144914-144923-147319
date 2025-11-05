import api from '../utils/api';

/**
 * PUBLIC_INTERFACE
 * listUsers
 * Calls GET /api/users with optional query params:
 * - page, limit: when provided, backend returns envelope { success, data, meta }
 * - sort: e.g., -updated_at
 * - filter: JSON string filter (e.g., {"status":"active"})
 * - search: case-insensitive search
 */
export async function listUsers({ page, limit, sort, filter, search } = {}) {
  const params = {};
  if (page != null) params.page = page;
  if (limit != null) params.limit = limit;
  if (sort) params.sort = sort;
  if (filter) params.filter = filter;
  if (search) params.search = search;

  const res = await api.get('/api/users', { params });
  return res.data;
}
