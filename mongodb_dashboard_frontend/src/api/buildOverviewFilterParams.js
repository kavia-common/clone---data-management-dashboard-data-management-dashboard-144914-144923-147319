import { buildFilterParam } from './buildFilterParam';

/**
 * PUBLIC_INTERFACE
 * buildOverviewQueryParams
 * Map a filter object into query params aligned with backend expectations.
 * Supports: tenant/organization, from/to or start/end (per endpoint), granularity.
 *
 * @param {Object} filter - { tenantId?, organization_id?, from?, to?, start?, end?, granularity? }
 * @param {Object} options - { useStartEnd?: boolean } when true uses start/end instead of from/to
 * @returns {Record<string,string>}
 */
export function buildOverviewQueryParams(filter = {}, options = {}) {
  const { useStartEnd = false } = options;
  const params = {};

  // Tenant: send as organization_id to be consistent; server also supports tenant_id aliases.
  if (filter.organization_id || filter.tenantId) {
    params.organization_id = filter.organization_id || filter.tenantId;
  }

  // Date range
  if (useStartEnd) {
    if (filter.start || filter.from) params.start = (filter.start || filter.from);
    if (filter.end || filter.to) params.end = (filter.end || filter.to);
  } else {
    if (filter.from) params.from = filter.from;
    if (filter.to) params.to = filter.to;
  }

  // Granularity: day|week|month (some endpoints only accept day|week)
  if (filter.granularity) params.granularity = filter.granularity;

  // passthrough for other supported fields if provided via buildFilterParam pattern
  const extra = buildFilterParam(filter?.extra || {});
  if (extra) params.filter = extra;

  return params;
}
