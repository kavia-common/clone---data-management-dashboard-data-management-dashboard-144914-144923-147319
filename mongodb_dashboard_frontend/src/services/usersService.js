import { getApiClient } from '../api/baseClient';

/**
 * PUBLIC_INTERFACE
 * listUsersServerFiltered
 * Fetch users from /api/users with server-side filtering for createdAt/updatedAt date range and tenant scope.
 * The backend contract allows a "filter" JSON parameter. We support either created_at, createdAt, updated_at, updatedAt.
 * We always include organization_id for tenant scoping via baseClient; explicit organization_id param further enforces it.
 *
 * @param {Object} opts
 * @param {string} opts.organization_id - Tenant (organization) id to scope results
 * @param {string|null} opts.from - ISO datetime (inclusive lower bound)
 * @param {string|null} opts.to - ISO datetime (inclusive upper bound)
 * @param {number} [opts.limit=500] - Page size hint; backend may ignore for this endpoint
 * @returns {Promise<Array<Object>>} Array of user documents
 */
export async function listUsersServerFiltered({ organization_id, from = null, to = null, limit = 500 } = {}) {
  const api = getApiClient();

  // Build a filter that tries both created_at and updated_at to be safe with varied schemas
  // created_at-based filtering: we pass the range on created_at (and aliases) via filter JSON
  const filter = {};
  if (from || to) {
    const gte = from || undefined;
    const lte = to || undefined;

    // Try created_at and updated_at variants. Backend should ignore unknown fields harmlessly.
    const range = {};
    if (gte) range.$gte = gte;
    if (lte) range.$lte = lte;

    filter.created_at = { ...range };
    filter.createdAt = { ...range };
    filter.updated_at = { ...range };
    filter.updatedAt = { ...range };
  }

  // Build query params; baseClient sanitization will keep only organization_id and filter/limit/sort/page for /api/users
  const params = { organization_id, limit, filter: Object.keys(filter).length ? JSON.stringify(filter) : undefined };

  const res = await api.get('/api/users', { params });
  const payload = res?.data;

  // Normalize array/envelope
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

export default { listUsersServerFiltered };
