'use strict';

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Backward-compatible middleware that ensures req.organizationId/req.context.organizationId
 * is available if x-organization-id header or query aliases are provided.
 * This version is permissive and does not 400 when missing.
 */
function extractOrganization() {
  return function (req, _res, next) {
    const headerOrg = req.headers?.['x-organization-id'];
    const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : undefined;
    const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id : undefined;
    const resolved = headerOrg || qTenant || qOrg || req.organizationId || null;

    if (!req.context) req.context = {};
    if (resolved) {
      req.organizationId = String(resolved);
      req.tenantId = String(resolved);
      req.context.organizationId = String(resolved);
    }
    return next();
  };
}

module.exports = { extractOrganization };
