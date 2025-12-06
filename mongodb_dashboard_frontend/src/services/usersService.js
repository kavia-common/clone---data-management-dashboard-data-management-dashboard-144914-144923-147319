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
function toIso(d) {
  return d ? new Date(d).toISOString() : null;
}

/**
 * Compute inclusive date range boundaries for created_at using precise start/end of day/month.
 * - daily: startOfDay(now) to endOfDay(now)
 * - weekly: startOfDay(now - 6 days) to endOfDay(now) [last 7 days inclusive]
 * - monthly: startOfMonth(now) to endOfMonth(now)
 * - custom: startOfDay(from) to endOfDay(to)
 */
function computeCreatedAtWindow({ mode = 'custom', from, to }) {
  const now = new Date();

  const startOfDay = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };
  const startOfMonth = (d) => {
    const x = new Date(d);
    x.setDate(1);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfMonth = (d) => {
    const x = new Date(d);
    x.setMonth(x.getMonth() + 1, 0); // move to last day of current month
    x.setHours(23, 59, 59, 999);
    return x;
  };

  if (mode === 'daily') {
    const s = startOfDay(now);
    const e = endOfDay(now);
    return { gte: toIso(s), lte: toIso(e) };
  }
  if (mode === 'weekly') {
    const s = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
    const e = endOfDay(now);
    return { gte: toIso(s), lte: toIso(e) };
  }
  if (mode === 'monthly') {
    const s = startOfMonth(now);
    const e = endOfMonth(now);
    return { gte: toIso(s), lte: toIso(e) };
  }
  // custom
  const s = startOfDay(from || now);
  const e = endOfDay(to || now);
  return { gte: toIso(s), lte: toIso(e) };
}

/**
 * PUBLIC_INTERFACE
 * listUsersServerFiltered
 * Fetch users from /api/users with server-side filtering for created_at date range and tenant scope.
 * The backend contract allows a "filter" JSON parameter. We pass Mongo-style operators $gte/$lte.
 * We always include organization_id for tenant scoping via baseClient; explicit organization_id param further enforces it.
 *
 * @param {Object} opts
 * @param {string} opts.organization_id - Tenant (organization) id to scope results
 * @param {'daily'|'weekly'|'monthly'|'custom'} [opts.mode='custom'] - Time selection
 * @param {string|Date|null} [opts.from=null] - Start date (used for custom)
 * @param {string|Date|null} [opts.to=null] - End date (used for custom)
 * @param {number} [opts.limit=500] - Page size hint
 * @returns {Promise<Array<Object>>} Array of user documents
 */
export async function listUsersServerFiltered({ organization_id, mode = 'custom', from = null, to = null, limit = 500 } = {}) {
  const api = getApiClient();

  // Compute precise created_at window
  const { gte, lte } = computeCreatedAtWindow({ mode, from, to });

  // Build Mongo-style filter for created_at with $gte/$lte
  const filter = {
    created_at: {},
  };
  if (gte) filter.created_at.$gte = gte;
  if (lte) filter.created_at.$lte = lte;

  // Build query params; baseClient sanitization will keep only organization_id and filter/limit/sort/page for /api/users
  const params = {
    organization_id,
    limit,
    // Send object directly; baseClient will JSON.stringify it in toQuery
    filter,
  };

  const res = await api.get('/api/users', { params });
  const payload = res?.data;

  // Normalize array/envelope
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

export default { listUsersServerFiltered };
