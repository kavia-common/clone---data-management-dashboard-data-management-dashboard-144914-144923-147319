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
    (req.headers && (req.headers['x-tenant-id'] || req.headers['x-tenant'])) ||
    null;

  if (!tenantId) {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      // eslint-disable-next-line no-console
      console.debug('[requireTenant] Missing tenant. Headers:', {
        authorization: !!(req.headers?.authorization || req.headers?.Authorization),
        xTenant: req.headers?.['x-tenant-id'] || req.headers?.['x-tenant'] || null,
        path: req.originalUrl,
        method: req.method,
      });
    }
    return res.status(403).json({ success: false, message: 'Tenant not set in token' });
  }

  // normalize to req.auth.tenantId for downstream usage
  req.auth = req.auth || {};
  req.auth.tenantId = req.auth.tenantId || tenantId;

  return next();
}

module.exports = { requireTenant };
