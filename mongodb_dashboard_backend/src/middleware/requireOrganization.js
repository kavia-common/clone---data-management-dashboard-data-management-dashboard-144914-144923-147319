'use strict';

/**
 * PUBLIC_INTERFACE
 * requireOrganization
 *
 * Strict middleware for endpoints that MUST be scoped to an organization/tenant.
 * Resolution precedence:
 *  1) JWT: req.auth.tenantId (cannot be overridden)
 *  2) Header: x-organization-id | x-tenant-id | x-tenant | organization_id
 *  3) Query: ?tenant_id or ?organization_id
 * Behavior:
 *  - If JWT present and client-provided org conflicts, respond 403.
 *  - If no resolved organizationId, respond 400 with a clear message.
 *  - On success, sets req.organizationId, req.tenantId and echoes 'x-organization-id' header.
 */
function requireOrganization(req, res, next) {
  const jwtTenant = req?.auth?.tenantId ? String(req.auth.tenantId) : null;

  const hdrCandidate =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    null;

  const qCandidate =
    (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
    (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
    null;

  // Precedence header over query when JWT is not present
  const resolved = jwtTenant || hdrCandidate || qCandidate || null;

  // If JWT present, ensure no conflict with client values
  if (jwtTenant) {
    const clientProvided = hdrCandidate || qCandidate;
    if (clientProvided && String(clientProvided) !== String(jwtTenant)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
  }

  if (!resolved) {
    return res.status(400).json({
      success: false,
      message:
        'Missing tenant scope: provide x-organization-id header or ?tenant_id / ?organization_id.',
    });
  }

  const id = String(resolved);
  req.organizationId = id;
  req.tenantId = id;
  if (!req.context) req.context = {};
  req.context.organizationId = id;

  try {
    res.set('x-organization-id', id);
  } catch (_) {}

  return next();
}

module.exports = { requireOrganization };
