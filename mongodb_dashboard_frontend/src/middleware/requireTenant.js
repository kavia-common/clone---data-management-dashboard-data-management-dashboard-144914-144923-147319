'use strict';

/**
 * requireTenant middleware
 * - Ensures req.auth.tenantId is present
 * - If route contains :tenantId, enforce it matches req.auth.tenantId unless bypass via admin role
 */
// PUBLIC_INTERFACE
function requireTenant(req, res, next) {
  const tenantId = req?.auth?.tenantId || req?.user?.tenant_id || req?.user?.tenantId;
  if (!tenantId) {
    return res.status(403).json({ success: false, message: 'Tenant context required' });
  }

  // Normalize
  req.auth = req.auth || {};
  req.auth.tenantId = tenantId;

  // Guard rails for routes with :tenantId parameter
  const paramTenant = req.params?.tenantId;
  const roles = req.auth.roles || [];

  if (paramTenant && paramTenant !== tenantId) {
    // Allow only if admin-like role present
    const isAdmin = roles.includes('admin') || roles.includes('superadmin') || roles.includes('tenant:read:all');
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
  }

  next();
}

module.exports = { requireTenant };
