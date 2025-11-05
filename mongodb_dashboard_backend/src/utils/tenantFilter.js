'use strict';

/**
 * PUBLIC_INTERFACE
 * withTenantFilter ensures a base Mongo query is constrained to the tenant in the request context.
 * It injects { tenant_id: req.auth.tenantId } and rejects attempts to override tenant_id.
 * @param {Request} req - Express request with req.auth.tenantId
 * @param {object} baseQuery - Existing query/filter object
 * @returns {object} New query merged with tenant constraint
 */
function withTenantFilter(req, baseQuery = {}) {
  if (!req.auth || !req.auth.tenantId) {
    throw new Error('Missing tenant context');
  }
  if (baseQuery && Object.prototype.hasOwnProperty.call(baseQuery, 'tenant_id')) {
    // Prevent mismatched tenant or attempts to remove/change tenant scope
    if (baseQuery.tenant_id !== req.auth.tenantId) {
      throw new Error('Tenant mismatch in query');
    }
  }
  return { ...baseQuery, tenant_id: req.auth.tenantId };
}

/**
 * PUBLIC_INTERFACE
 * tenantMatchStage returns an aggregation $match stage enforcing the current tenant.
 * It will not allow overriding tenant and will always enforce the current tenant_id.
 * @param {Request} req
 * @param {object} [extraMatch] - optional extra match to combine
 * @returns {{$match: object}}
 */
function tenantMatchStage(req, extraMatch = {}) {
  if (!req.auth || !req.auth.tenantId) {
    throw new Error('Missing tenant context');
  }
  const sanitized = { ...extraMatch };
  if (Object.prototype.hasOwnProperty.call(sanitized, 'tenant_id')) {
    if (sanitized.tenant_id !== req.auth.tenantId) {
      throw new Error('Tenant mismatch in pipeline match');
    }
  }
  return { $match: { ...sanitized, tenant_id: req.auth.tenantId } };
}

/**
 * PUBLIC_INTERFACE
 * enforceTenantOnDoc forces doc.tenant_id to current tenant and prevents overrides.
 * @param {Request} req
 * @param {object} doc
 * @returns {object} mutated doc with enforced tenant_id
 */
function enforceTenantOnDoc(req, doc = {}) {
  if (!req.auth || !req.auth.tenantId) {
    throw new Error('Missing tenant context');
  }
  const out = { ...doc, tenant_id: req.auth.tenantId };
  if (doc && Object.prototype.hasOwnProperty.call(doc, 'tenant_id')) {
    if (doc.tenant_id !== req.auth.tenantId) {
      throw new Error('Tenant mismatch in payload');
    }
  }
  return out;
}

/**
 * PUBLIC_INTERFACE
 * enforceTenantOnUpdate ensures $set tenant_id equals current tenant and blocks cross-tenant updates.
 * Applies for updateOne/updateMany/findOneAndUpdate payloads.
 * @param {Request} req
 * @param {object} update
 * @returns {object} sanitized update
 */
function enforceTenantOnUpdate(req, update = {}) {
  if (!req.auth || !req.auth.tenantId) {
    throw new Error('Missing tenant context');
  }
  const u = { ...update };

  // Disallow direct top-level tenant_id change
  if (Object.prototype.hasOwnProperty.call(u, 'tenant_id')) {
    if (u.tenant_id !== req.auth.tenantId) {
      throw new Error('Tenant mismatch in update');
    }
  }

  if (!u.$set) u.$set = {};
  if (Object.prototype.hasOwnProperty.call(u.$set, 'tenant_id')) {
    if (u.$set.tenant_id !== req.auth.tenantId) {
      throw new Error('Tenant mismatch in update.$set');
    }
  }
  u.$set.tenant_id = req.auth.tenantId;

  // Guard against $unset/$rename for tenant_id
  if (u.$unset && Object.prototype.hasOwnProperty.call(u.$unset, 'tenant_id')) {
    throw new Error('Cannot unset tenant_id');
  }
  if (u.$rename && Object.prototype.hasOwnProperty.call(u.$rename, 'tenant_id')) {
    throw new Error('Cannot rename tenant_id');
  }

  return u;
}

module.exports = {
  withTenantFilter,
  tenantMatchStage,
  enforceTenantOnDoc,
  enforceTenantOnUpdate,
};
