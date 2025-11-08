'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant
 * Ensures a tenantId is present from the authenticated JWT; rejects cross-tenant overrides via headers.
 * In development when demo auth is enabled, allows header fallback ONLY if no JWT auth exists.
 * Attaches req.tenantId for downstream DB filters.
 */
function requireTenant(req, res, next) {
  const headerTenant = req.headers['x-tenant-id'] || req.headers['x-tenant'];
  // Prefer JWT tenantId if present
  const jwtTenant = req?.auth?.tenantId;

  // Disallow overriding a present JWT tenant via header to prevent cross-tenant access
  if (jwtTenant) {
    req.tenantId = String(jwtTenant);
    return next();
  }

  // No JWT present. Allow header fallback only in non-production demo mode.
  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';
  if (!isProd && allowDemo && headerTenant) {
    req.auth = req.auth || {};
    req.auth.tenantId = String(headerTenant);
    req.tenantId = String(headerTenant);
    return next();
  }

  return res.status(403).json({ success: false, message: 'Tenant required' });
}

module.exports = { requireTenant };
