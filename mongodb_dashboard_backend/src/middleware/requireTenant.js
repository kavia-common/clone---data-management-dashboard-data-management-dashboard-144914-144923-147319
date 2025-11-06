'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant middleware
 * Ensures req.auth.tenantId is present and, if a :tenantId route parameter exists,
 * enforces it matches the authenticated tenant unless an admin-like role is present.
 *
 * Returns 403 when tenant context is missing or mismatched.
 */
function requireTenant(req, res, next) {
  const tenantId =
    req?.auth?.tenantId ||
    req?.user?.tenant_id ||
    req?.user?.tenantId ||
    null;

  if (!tenantId) {
    return res.status(403).json({ success: false, message: 'Tenant context required' });
  }

  // Normalize onto req.auth
  req.auth = req.auth || {};
  req.auth.tenantId = tenantId;

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
