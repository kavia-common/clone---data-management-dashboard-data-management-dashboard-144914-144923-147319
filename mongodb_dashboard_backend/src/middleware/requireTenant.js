'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant middleware ensures a tenant is present in the auth context.
 * Looks for req.auth.tenantId (preferred) or legacy req.user.tenant_id or req.tenant.id.
 * Responds with 403 when tenant is not available.
 */
function requireTenant(req, res, next) {
  const tenantId =
    req?.auth?.tenantId ||
    req?.user?.tenant_id ||
    req?.tenant?.id ||
    null;

  if (!tenantId) {
    return res.status(403).json({ success: false, message: 'Tenant not set in token' });
  }

  // normalize to req.auth.tenantId for downstream usage
  req.auth = req.auth || {};
  req.auth.tenantId = req.auth.tenantId || tenantId;

  return next();
}

module.exports = { requireTenant };
