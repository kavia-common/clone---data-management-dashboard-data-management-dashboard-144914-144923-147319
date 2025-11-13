"use strict";

/**
 * PUBLIC_INTERFACE
 * organizationMiddleware
 * 
 * Normalizes and attaches organization/tenant identifier to the request.
 * - Accepts 'x-organization-id' header (preferred) or '?organization_id=' query param.
 * - Also accepts '?tenant_id=' as an alias.
 * - If provided, sets:
 *    req.organizationId
 *    req.context.organizationId (when req.context exists)
 *    req.tenantId (alias for compatibility)
 * - Does NOT hard-fail when missing; routes can decide to require it for business logic.
 *   This ensures APIs don't return 400 just because organization_id was supplied previously.
 */
function organizationMiddleware(req, _res, next) {
  try {
    const headerOrg = req.header("x-organization-id");
    const queryOrg = req.query?.organization_id || req.query?.tenant_id;

    // Header takes precedence
    const resolvedOrgId = headerOrg || queryOrg || null;

    // Ensure context exists
    if (!req.context) {
      req.context = {};
    }

    if (resolvedOrgId) {
      req.organizationId = resolvedOrgId;
      req.tenantId = resolvedOrgId; // alias used in some modules
      req.context.organizationId = resolvedOrgId;
    } else {
      // Keep fields undefined to signal absence without forcing errors
      // This maintains optional behavior.
      req.organizationId = req.organizationId || undefined;
      req.tenantId = req.tenantId || undefined;
      if (typeof req.context.organizationId === "undefined") {
        req.context.organizationId = undefined;
      }
    }

    return next();
  } catch (err) {
    // Never break requests due to org extraction errors; proceed without tenant scope
    return next();
  }
}

module.exports = organizationMiddleware;
