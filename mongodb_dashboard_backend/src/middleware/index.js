'use strict';
/**
 * PUBLIC_INTERFACE
 * Middleware registry: export common middlewares for centralized imports.
 *
 * Normalize to named constant to satisfy import/no-anonymous-default-export.
 */
 
/**
 * PUBLIC_INTERFACE
 * tenantScopeEnforcer
 * Lightweight middleware to attach diagnostic headers for tenant scope and act as a stub enforcer.
 * This intentionally does not override resolution performed by verifyAuth/requireTenant.
 */
function tenantScopeEnforcer() {
  return function (req, res, next) {
    try {
      if (req.tenantScopeDisabled || req.allTenants) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (req.tenantId) {
        res.set('X-Applied-Tenant', String(req.tenantId));
      }
    } catch (_) {}
    return next();
  };
}

const middleware = {
  verifyAuth: require('./verifyAuth').verifyAuth,
  requireTenant: require('./requireTenant').requireTenant,
  ...require('./authTenant'),
  extractOrganization: require('./extractOrganization').extractOrganization,
  tenantScopeEnforcer,
};

module.exports = {
  middleware,
  default: middleware,
  // PUBLIC_INTERFACE
  tenantScopeEnforcer,
  // PUBLIC_INTERFACE
  verifyAuth: middleware.verifyAuth,
  // PUBLIC_INTERFACE
  requireTenant: middleware.requireTenant,
  // PUBLIC_INTERFACE
  extractOrganization: middleware.extractOrganization,
};
