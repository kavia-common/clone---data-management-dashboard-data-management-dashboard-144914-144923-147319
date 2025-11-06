'use strict';

/**
 * PUBLIC_INTERFACE
 * verifyAuth middleware
 * Validates Authorization: Bearer <token>, verifies JWT (HS256 by default),
 * and populates req.auth with { sub, email, roles[], tenantId } and req.user with decoded claims.
 * Cognito-compatible: tenant read from "custom:tenant_id" or "tenant_id" (also supports tenantId/organization_id).
 *
 * This file provides a thin wrapper around jwtAuth utilities for explicit import if needed.
 */
const { verifyTenantAccess } = require('./jwtAuth');

// PUBLIC_INTERFACE
function verifyAuth(req, res, next) {
  return verifyTenantAccess(req, res, next);
}

module.exports = verifyAuth;
