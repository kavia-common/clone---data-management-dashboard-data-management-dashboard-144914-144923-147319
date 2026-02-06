'use strict';

/**
 * Minimal tenant scope resolver compatible with existing project conventions.
 * - If Authorization/JWT middleware already set req.auth.tenantId, we use it.
 * - Else we consider x-organization-id header, then ?tenant_id or ?organization_id.
 * Exposes two helpers:
 *  - resolveTenantScope: express middleware to annotate req for downstream
 *  - buildTenantScopeFilter(req): returns { tenantId, filter, source }
 */

// PUBLIC_INTERFACE
function resolveTenantScope(req, _res, next) {
  const headerTenant = req.headers['x-organization-id'];
  const queryTenant = req.query.tenant_id || req.query.organization_id;
  const authTenant = req?.auth?.tenantId;
  const tenantId = authTenant || headerTenant || queryTenant || null;
  req.tenantScope = {
    tenantId,
    source: authTenant ? 'auth' : (headerTenant ? 'header' : (queryTenant ? 'query' : null))
  };
  next();
}

// PUBLIC_INTERFACE
function buildTenantScopeFilter(req) {
  const tenantId =
    req?.tenantScope?.tenantId ||
    req?.auth?.tenantId ||
    req?.headers['x-organization-id'] ||
    req?.query?.tenant_id ||
    req?.query?.organization_id ||
    null;

  const source =
    req?.tenantScope?.source ||
    (req?.auth?.tenantId
      ? 'auth'
      : req?.headers['x-organization-id']
        ? 'header'
        : req?.query?.tenant_id || req?.query?.organization_id
          ? 'query'
          : null);

  // Special-case: T0000 (or any T followed by only zeros) is the Super Admin "all tenants" selector.
  // In that mode we must NOT inject a tenant filter, otherwise results are always empty.
  const isAllTenantsSelector =
    typeof tenantId === 'string' && /^T0+$/i.test(String(tenantId).trim());

  return {
    tenantId,
    filter: !tenantId || isAllTenantsSelector ? {} : { tenant_id: tenantId },
    source,
    isAllTenantsSelector,
  };
}

module.exports = {
  resolveTenantScope,
  buildTenantScopeFilter
};
