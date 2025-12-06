import { getApiClient } from '../api/baseClient';

/**
 * PUBLIC_INTERFACE
 * Helpers to compute precise ISO boundaries.
 */
function toIso(d) {
  try {
    return d ? new Date(d).toISOString() : null;
  } catch {
    return null;
  }
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfMonth(d) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * PUBLIC_INTERFACE
 * listUsersServerFiltered
 * Fetch users from /api/users with server-side filtering for created_at date range and tenant scope.
 * The backend contract allows a "filter" JSON parameter. We pass Mongo-style operators $gte/$lte.
 *
 * @param {Object} opts
 * @param {string} opts.organization_id - Tenant (organization) id to scope results
 * @param {'daily'|'weekly'|'monthly'|'custom'} [opts.mode='custom'] - Time selection
 * @param {string|Date|null} [opts.from=null] - Start date (used for custom)
 * @param {string|Date|null} [opts.to=null] - End date (used for custom)
 * @param {number} [opts.limit=500] - Page size hint
 * @returns {Promise<Array<Object>>} Array of user documents
 */
export async function listUsersServerFiltered({
  organization_id,
  mode = 'custom',
  from = null,
  to = null,
  limit = 500,
} = {}) {
  const api = getApiClient();
  const now = new Date();

  let gteIso = null;
  let lteIso = null;

  if (mode === 'daily') {
    gteIso = toIso(startOfDay(now));
    lteIso = toIso(endOfDay(now));
  } else if (mode === 'weekly') {
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    gteIso = toIso(startOfDay(s));
    lteIso = toIso(endOfDay(now));
  } else if (mode === 'monthly') {
    gteIso = toIso(startOfMonth(now));
    lteIso = toIso(endOfMonth(now));
  } else {
    // custom
    gteIso = toIso(startOfDay(from || now));
    lteIso = toIso(endOfDay(to || now));
  }

  const filter = { created_at: {} };
  if (gteIso) filter.created_at.$gte = gteIso;
  if (lteIso) filter.created_at.$lte = lteIso;

  // Intentionally querying /api/users only; tenant-summary endpoint is deprecated in UI.
  // We send organization_id and a Mongo-style filter for created_at with $gte/$lte.
  const params = {
    organization_id,
    limit,
    filter,
    mode, // optional hint; backend can ignore
  };

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[usersService] GET /api/users with params', params);
  }

  const res = await api.get('/api/users', { params });
  const payload = res?.data;

  // Normalize array/envelope
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

export default { listUsersServerFiltered };
