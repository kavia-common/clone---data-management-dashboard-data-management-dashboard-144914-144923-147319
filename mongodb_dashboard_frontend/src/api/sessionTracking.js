import { getApiClient } from './baseClient';
import { buildQueryString } from './util';

/**
 * PUBLIC_INTERFACE
 * fetchSessionTracking
 * Fetch session tracking records with pagination, sorting, and optional text search.
 * Enforces tenant scoping via tenant_id and forwards service_type filter explicitly.
 * Safely merges only supported params and ignores unknown/rest values to avoid leaking.
 *
 * @param {Object} params
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {string} [params.tenant_id] Active tenant scope (alias: tenantId, organization_id)
 * @param {string} [params.tenantId] Alias for tenant scope
 * @param {string} [params.organization_id] Alias for tenant scope
 * @param {string} [params.sort]
 * @param {string} [params.q] Text search query (applies to service_type and other fields)
 * @param {string} [params.service_type] Explicit filter for service type
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}) {
  const {
    page,
    limit,
    tenant_id,
    tenantId,            // alias support
    organization_id,     // alias support
    sort,
    q,
    service_type,        // explicit service_type filter passthrough
  } = params || {};

  // Build safe param bag; do not forward unknown keys
  const safeParams = {};
  if (page !== undefined) safeParams.page = page;
  if (limit !== undefined) safeParams.limit = limit;

  // Resolve tenant from supported aliases (explicit precedence order)
  const resolvedTenant = tenant_id ?? tenantId ?? organization_id;
  if (resolvedTenant !== undefined && resolvedTenant !== null && resolvedTenant !== '') {
    safeParams.tenant_id = resolvedTenant;
  }

  if (sort !== undefined) safeParams.sort = sort;
  if (q !== undefined && q !== '') safeParams.q = q;

  // Forward service_type if present
  if (service_type !== undefined && service_type !== '') {
    safeParams.service_type = service_type;
  }

  const qs = buildQueryString(safeParams);
  const url = `/api/session-tracking${qs}`;
  const res = await getApiClient().get(url);
  const payload = res?.data ?? res;

  // Normalize to items/total/meta with guards for malformed responses
  const items = Array.isArray(payload) ? payload : payload?.data ?? [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === 'number' && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  const meta = payload?.meta ?? null;

  return { items, total, meta };
}

/* No default export to favor named exports (lint rule) */
