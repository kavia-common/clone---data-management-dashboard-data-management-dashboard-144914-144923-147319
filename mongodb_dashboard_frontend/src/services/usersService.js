import { getApiClient, listUsers } from '../api/baseClient';
import { getOrganizationId as getTenantOrganizationId } from '../api/authTokenProvider';
import { toUtcDateString, startOfUtcDay, endOfUtcDay, getWeeklyUtcRange, getMonthlyUtcRange } from '../utils/dateUtc';

/**
 * PUBLIC_INTERFACE
 * buildCreatedAtDateOnlyFilter
 * Build Mongo-style created_at filter using UTC day boundaries with YYYY-MM-DD strings.
 * Returns undefined if no valid window could be determined.
 */
export function buildCreatedAtDateOnlyFilter({
  mode,
  selectedDate,
  selectedWeekAnchor,
  selectedMonthAnchor,
  customFrom,
  customTo,
} = {}) {
  let fromDate = null;
  let toDate = null;

  const m = (mode || '').toLowerCase();

  if (m === 'daily') {
    const d = selectedDate ? new Date(selectedDate) : new Date();
    fromDate = startOfUtcDay(d);
    toDate = endOfUtcDay(d);
  } else if (m === 'weekly') {
    const anchor = selectedWeekAnchor ? new Date(selectedWeekAnchor) : new Date();
    const [start, end] = getWeeklyUtcRange(anchor);
    fromDate = start;
    toDate = end;
  } else if (m === 'monthly') {
    const anchor = selectedMonthAnchor ? new Date(selectedMonthAnchor) : new Date();
    const [start, end] = getMonthlyUtcRange(anchor);
    fromDate = start;
    toDate = end;
  } else if (m === 'custom') {
    if (customFrom) fromDate = startOfUtcDay(new Date(customFrom));
    if (customTo) toDate = endOfUtcDay(new Date(customTo));
  } else {
    // No time mode provided; do not add a created_at filter
    return undefined;
  }

  const range = {};
  if (fromDate) range.$gte = toUtcDateString(fromDate);
  if (toDate) range.$lte = toUtcDateString(toDate);
  if (!Object.keys(range).length) return undefined;
  return { created_at: range };
}

/**
 * PUBLIC_INTERFACE
 * fetchUsers
 * Fetch users from /api/users including:
 * - organization_id (tenant) always
 * - mode passed through unchanged
 * - filter containing created_at { $gte: 'YYYY-MM-DD', $lte: 'YYYY-MM-DD' } if applicable
 * Other params (page, limit, sort) pass through unchanged.
 */
export async function fetchUsers(params = {}) {
  const {
    mode,
    selectedDate,
    selectedWeekAnchor,
    selectedMonthAnchor,
    customFrom,
    customTo,
    filter: existingFilter,
    ...rest
  } = params || {};

  const organization_id =
    rest.organization_id ||
    getTenantOrganizationId?.() ||
    undefined;

  const createdAtFilter = buildCreatedAtDateOnlyFilter({
    mode,
    selectedDate,
    selectedWeekAnchor,
    selectedMonthAnchor,
    customFrom,
    customTo,
  });

  const filter = {
    ...(existingFilter || {}),
    ...(createdAtFilter ? createdAtFilter : {}),
  };

  const query = {
    ...rest,
    ...(organization_id ? { organization_id } : {}),
    ...(mode ? { mode } : {}),
    ...(Object.keys(filter).length ? { filter } : {}),
  };

  // Use baseClient's get which preserves JSON string as needed
  const api = getApiClient();
  const res = await api.get('/api/users', { params: query });
  return res?.data;
}

/**
 * PUBLIC_INTERFACE
 * listUsersServerFiltered
 * Backwards-compat shim for existing code paths; uses fetchUsers with explicit from/to and mode.
 * Note: Converts 'from'/'to' datetimes to date-only bounds via buildCreatedAtDateOnlyFilter by passing custom mode.
 */
export async function listUsersServerFiltered({
  organization_id,
  mode = 'custom',
  from = null,
  to = null,
  limit = 500,
} = {}) {
  const payload = await fetchUsers({
    organization_id,
    mode,
    customFrom: from || undefined,
    customTo: to || undefined,
    limit,
  });

  // Normalize array/envelope for callers that expect array
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.items)) return payload.items;
  return [];
}

export default { fetchUsers, listUsersServerFiltered, buildCreatedAtDateOnlyFilter };
