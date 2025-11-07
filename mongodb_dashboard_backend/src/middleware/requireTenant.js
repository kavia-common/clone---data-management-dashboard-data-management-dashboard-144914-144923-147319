'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant
 * Ensures req.auth.tenantId is present; otherwise responds 403.
 * For development without real auth, allows override via X-Tenant-Id header.
 */
function requireTenant(req, res, next) {
  const headerTenant = req.headers['x-tenant-id'] || req.headers['x-tenant'];
  if (headerTenant && (!req.auth || !req.auth.tenantId)) {
    req.auth = req.auth || {};
    req.auth.tenantId = String(headerTenant);
  }

  if (!req.auth || !req.auth.tenantId) {
    if (process.env.NODE_ENV !== 'production' || String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true') {
      try { console.warn('[requireTenant] Missing tenantId on req.auth'); } catch {}
    }
    return res.status(403).json({ success: false, message: 'Tenant required' });
  }
  if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
    try { console.debug('[requireTenant] tenantId', req.auth.tenantId); } catch {}
  }
  return next();
}

module.exports = { requireTenant };
