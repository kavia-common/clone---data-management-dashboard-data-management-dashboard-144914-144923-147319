'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant
 * Ensures a tenantId is present from one of the allowed sources and attaches it to req.tenantId.
 * Precedence:
 *   1) JWT (req.auth.tenantId) when present — cannot be overridden.
 *   2) Header x-organization-id | x-tenant-id | x-tenant
 *   3) Query ?tenant_id=... or legacy ?organization_id=...
 *   4) Demo fallback (non-prod with ALLOW_DEMO_AUTH=true) may accept header or query.
 * On failure, responds with 403.
 */
function requireTenant(req, res, next) {
  // Prefer JWT tenantId if present (cannot be overridden)
  const jwtTenant = req?.auth?.tenantId;
  if (jwtTenant) {
    req.tenantId = String(jwtTenant);
    return next();
  }

  // Extract tenant from headers and query for non-JWT flows
  const hdrTenant =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    '';

  // Accept query parameters for tenant resolution (new: tenant_id; legacy: organization_id)
  const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || '';
  const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';

  const resolved = hdrTenant || qTenant || qOrg;

  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';

  if (resolved) {
    // If no JWT, accept header/query provided tenant
    req.auth = req.auth || {};
    req.auth.tenantId = String(resolved);
    req.tenantId = String(resolved);
    return next();
  }

  // Demo fallback (no JWT, no header/query). Allow using default or block based on settings.
  if (!isProd && allowDemo) {
    const demoTenant =
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      (process.env.AUTH_DEFAULT_TENANT || 'DEMO');
    req.auth = req.auth || {};
    req.auth.tenantId = String(demoTenant);
    req.tenantId = String(demoTenant);
    return next();
  }

  return res.status(403).json({
    success: false,
    message:
      'Tenant required: provide via JWT, header x-organization-id/x-tenant-id, or query ?tenant_id=... (legacy: ?organization_id=...)',
  });
}

module.exports = { requireTenant };