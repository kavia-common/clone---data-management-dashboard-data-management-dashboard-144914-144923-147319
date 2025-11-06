'use strict';

const { verifyTenantAccess } = require('./jwtAuth');
const { requireTenant } = require('./requireTenant');

// Provide a named verifyAuth middleware expected by routers
function verifyAuth(req, res, next) {
  return verifyTenantAccess(req, res, next);
}

// Backward-compatible exports
module.exports = {
  verifyAuth,
  requireTenant,
  // tenantFilter was previously exported; keep a no-op stub for compatibility
  tenantFilter: (x) => x,
};
