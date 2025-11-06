'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant middleware
 *
 * Ensures a tenantId exists on the request and normalizes it onto:
 *   - req.auth.tenantId
 *   - req.tenantId (shortcut)
 *
 * If a route parameter :tenantId is present, it must match the authenticated
 * tenant unless an admin-like role is present (admin|superadmin|tenant:read:all).
 *
 * Returns 403 when tenant context is missing or mismatched.
 *
 * Usage:
 *   const { verifyAuth } = require('../middleware');
 *   const { requireTenant } = require('./requireTenant');
 *   router.use(verifyAuth, requireTenant);
 */
function requireTenant(req, res, next) {
  const tenantId =
    req?.auth?.tenantId ||
    req?.user?.tenant_id ||
    req?.user?.tenantId ||
    null;

  if (!tenantId) {
    return res
      .status(403)
      .json({ success: false, message: 'Tenant context required' });
  }

  // Normalize onto req.auth and shortcut
  req.auth = req.auth || {};
  req.auth.tenantId = tenantId;
  req.tenantId = tenantId;

  // Guard rails for routes with :tenantId parameter
  const paramTenant = req.params?.tenantId;
  const roles = Array.isArray(req.auth?.roles)
    ? req.auth.roles
    : typeof req.auth?.roles === 'string'
    ? String(req.auth.roles)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (paramTenant && paramTenant !== tenantId) {
    const isAdmin =
      roles.includes('admin') ||
      roles.includes('superadmin') ||
      roles.includes('tenant:read:all');
    if (!isAdmin) {
      return res
        .status(403)
        .json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
  }

  return next();
}

module.exports = { requireTenant };
