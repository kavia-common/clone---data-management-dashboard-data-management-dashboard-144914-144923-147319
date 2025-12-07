import client from './client';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Fetches session tracking records. Accepts query object and optional fetch options.
 * - query: { page?, limit?, sort?, filter?, q?, pageSize?, tenant_id?, from?, to?, date_field? }
 * - options: { signal? }
 * Notes:
 * - Backend supports raw array response when page/limit not provided, else envelope.
 * - Use from/to and explicitly set date_field=session_start to ensure correct filtering.
 */
// PUBLIC_INTERFACE
export async function getSessionTracking(query = {}, options = {}) {
  const params = new URLSearchParams();

  // Map and sanitize params to match backend expectations
  const {
    start,
    end,
    from,
    to,
    tenant_id,
    organization_id, // ignored for session-tracking root (tenant_id used instead)
    filter,
    q,
    page,
    limit,
    pageSize,
    sort,
    date_field,
    ...rest
  } = query || {};

  const effectiveFrom = from || start;
  const effectiveTo = to || end;

  // Required/commonly used params
  if (tenant_id) params.append('tenant_id', tenant_id);
  if (effectiveFrom) params.append('from', effectiveFrom);
  if (effectiveTo) params.append('to', effectiveTo);

  // Explicitly set date_field to session_start unless caller overrides
  params.append('date_field', date_field || 'session_start');

  if (filter) params.append('filter', filter);
  if (q) params.append('q', q);
  if (page) params.append('page', page);
  if (limit) params.append('limit', limit);
  if (pageSize) params.append('pageSize', pageSize);
  if (sort) params.append('sort', sort);

  // Append any remaining simple scalars
  Object.entries(rest).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    params.append(k, v);
  });

  const res = await client.get(`/api/session-tracking?${params.toString()}`, {
    signal: options.signal,
  });
  // Client wrapper returns { data } for fetch; axios-like clients also expose data
  return res?.data ?? res;
}

// PUBLIC_INTERFACE
// Backward-compatibility alias to avoid build breaks if any old import remains
export const fetchSessionTracking = getSessionTracking;
