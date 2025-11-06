'use strict';

/**
 * Utilities to help with tenant filtering.
 * Injects tenant_id into find/findOne filters and as first stage in aggregations.
 */

// PUBLIC_INTERFACE
function ensureTenantFilter(originalFilter = {}, tenantId) {
  /** Merge provided filter with tenant_id constraint. */
  const filter = { ...(originalFilter || {}) };
  if (tenantId) {
    // Avoid overriding if tenant_id already set; enforce equality
    if (filter.tenant_id && filter.tenant_id !== tenantId) {
      // On conflict, enforce the authenticated tenant
      filter.tenant_id = tenantId;
    } else {
      filter.tenant_id = tenantId;
    }
  }
  return filter;
}

// PUBLIC_INTERFACE
function withTenantMatch(pipeline = [], tenantId) {
  /** Ensure the first stage is a $match on tenant_id */
  const match = { $match: { tenant_id: tenantId } };
  // If pipeline already starts with tenant match, replace it to be safe
  if (Array.isArray(pipeline) && pipeline.length > 0) {
    const first = pipeline[0];
    if (first && first.$match && Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id')) {
      const rest = pipeline.slice(1);
      return [match, ...rest];
    }
  }
  return [match, ...(pipeline || [])];
}

module.exports = {
  ensureTenantFilter,
  withTenantMatch,
};
