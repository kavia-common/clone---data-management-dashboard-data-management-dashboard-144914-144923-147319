'use strict';

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Backward-compatible middleware that ensures req.organizationId/req.context.organizationId
 * is available if x-organization-id header or query aliases are provided.
 * This version is permissive and does not 400 when missing.
 */
function extractOrganization() {
  return function (req, res, next) {
    const headerOrg =
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) || null;
    const qOrg =
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || null;
    const qTenant =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || null;

    // Precedence: header > organization_id > tenant_id > already set
    const resolved = headerOrg || qOrg || qTenant || req.organizationId || req.tenantId || null;

    if (!req.context) req.context = {};
    if (resolved) {
      const id = String(resolved);
      req.organizationId = id;
      req.tenantId = id;
      req.context.organizationId = id;
      try { res.set('x-organization-id', id); } catch (_) {}
    }
    return next();
  };
}

module.exports = { extractOrganization };
