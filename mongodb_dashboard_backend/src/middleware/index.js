'use strict';

const { verifyTenantAccess } = require('./jwtAuth');
const { requireTenant } = require('./requireTenant');
const simpleVerifyAuth = require('./verifyAuth');

/**
 * PUBLIC_INTERFACE
 * Middleware export surface
 * - verifyAuth: main JWT verification + tenant extraction middleware
 * - requireTenant: enforces tenant presence and :tenantId path checks
 */
module.exports = {
  verifyAuth: verifyTenantAccess,
  requireTenant,
  tenantFilter: (x) => x, // legacy no-op
  simpleVerifyAuth, // deprecated fallback
};
