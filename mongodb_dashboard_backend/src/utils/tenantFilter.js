'use strict';

/**
 * PUBLIC_INTERFACE
 * ensureTenantFilter
 * Merge tenant_id into provided criteria object, enforcing equality to the authenticated tenant.
 */
function ensureTenantFilter(original = {}, tenantId) {
  const criteria = { ...(original || {}) };
  if (!tenantId) return criteria;
  if (Object.prototype.hasOwnProperty.call(criteria, 'tenant_id')) {
    criteria.tenant_id = tenantId;
  } else {
    criteria.tenant_id = tenantId;
  }
  return criteria;
}

/**
 * PUBLIC_INTERFACE
 * withTenantMatch
 * Ensure first aggregation stage is { $match: { tenant_id: tenantId } }.
 * If the first stage already matches tenant_id, it is replaced.
 */
function withTenantMatch(pipeline = [], tenantId) {
  const head = { $match: { tenant_id: tenantId } };
  if (Array.isArray(pipeline) && pipeline.length > 0) {
    const first = pipeline[0];
    if (first && first.$match && Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id')) {
      return [head, ...pipeline.slice(1)];
    }
  }
  return [head, ...(pipeline || [])];
}

module.exports = { ensureTenantFilter, withTenantMatch };
