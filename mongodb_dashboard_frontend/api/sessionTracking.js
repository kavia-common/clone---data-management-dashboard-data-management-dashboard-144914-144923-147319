import client from './client';

/**
 * PUBLIC_INTERFACE
 * getSessionTracking
 * Fetches session tracking records. Accepts query object and optional fetch options.
 * - query: { page?, limit?, sort?, filter?, q?, pageSize?, tenant_id?, from?, to?, date_field? }
 * - options: { signal? }
 * Notes:
 * - Prefer from/to and date_field=session_start to align with backend filtering on session_start.
 */
export async function getSessionTracking(query = {}, options = {}) {
  const params = new URLSearchParams();

  const {
    start,
    end,
    from,
    to,
    tenant_id,
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

  if (tenant_id) params.append('tenant_id', tenant_id);
  if (effectiveFrom) params.append('from', effectiveFrom);
  if (effectiveTo) params.append('to', effectiveTo);
  params.append('date_field', date_field || 'session_start');

  if (filter) params.append('filter', filter);
  if (q) params.append('q', q);
  if (page) params.append('page', page);
  if (limit) params.append('limit', limit);
  if (pageSize) params.append('pageSize', pageSize);
  if (sort) params.append('sort', sort);

  Object.entries(rest).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    params.append(k, v);
  });

  const res = await client.get(`/api/session-tracking?${params.toString()}`, {
    signal: options.signal,
  });
  return res?.data ?? res;
}
