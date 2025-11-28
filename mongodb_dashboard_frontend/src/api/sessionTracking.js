import { getApiClient } from './baseClient';
import { buildQueryString } from './util';

/**
 * PUBLIC_INTERFACE
 * fetchSessionTracking
 * Fetch session tracking records with pagination, sorting, and optional text search.
 * Note: Backend no longer accepts or applies a 'filter' parameter or date-range compound filters.
 * Tenant scoping is enforced via tenant_id only (handled by baseClient).
 * Supports lightweight text search via ?q which includes service_type field on backend.
 *
 * @param {Object} params
 * @param {number} [params.page]
 * @param {number} [params.limit]
 * @param {string} [params.tenant_id] Active tenant scope (alias: organization_id on server)
 * @param {string} [params.sort]
 * @param {string} [params.q] Text search query (applies to service_type and other fields)
 * @returns {Promise<{ items: Array<any>, total: number, meta: any }>}
 */
export async function fetchSessionTracking(params = {}) {
  const {
    page,
    limit,
    tenant_id,
    tenantId,           // alias support
    sort,
    q,
    service_type,       // explicit service_type filter passthrough
    ...rest             // ignore unknowns but allow future expansion
  } = params || {};

  const safeParams = {};
  if (page !== undefined) safeParams.page = page;
  if (limit !== undefined) safeParams.limit = limit;

  // Prefer explicit tenant_id, then alias tenantId
  const resolvedTenant = tenant_id ?? tenantId;
  if (resolvedTenant !== undefined) safeParams.tenant_id = resolvedTenant;

  if (sort !== undefined) safeParams.sort = sort;
  if (q !== undefined) safeParams.q = q;

  // Forward service_type if present
  if (service_type !== undefined && service_type !== '') {
    safeParams.service_type = service_type;
  }

  const qs = buildQueryString(safeParams);
  const url = `/api/session-tracking${qs}`;
  const res = await getApiClient().get(url);
  const payload = res?.data ?? res;

  const items = Array.isArray(payload) ? payload : payload?.data ?? [];
  const total =
    (payload && payload.meta && typeof payload.meta.total === 'number' && payload.meta.total) ||
    (Array.isArray(items) ? items.length : 0);
  const meta = payload?.meta ?? null;

  return { items, total, meta };
}

/* No default export to favor named exports (lint rule) */
