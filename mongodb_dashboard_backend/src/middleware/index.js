'use strict';

const { verifyTenantAccess } = require('./jwtAuth');
const { requireTenant } = require('./requireTenant');
const simpleVerifyAuth = require('./verifyAuth');

// Backward-compatible exports: prefer verifyTenantAccess as verifyAuth
// Routes should import: const { verifyAuth } = require('../middleware');
module.exports = {
  verifyAuth: verifyTenantAccess,
  requireTenant,
  // tenantFilter was previously exported; keep a no-op stub for compatibility
  tenantFilter: (x) => x,
  simpleVerifyAuth, // deprecated fallback
};
