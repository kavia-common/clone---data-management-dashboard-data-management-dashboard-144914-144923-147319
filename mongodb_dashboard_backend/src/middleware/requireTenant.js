'use strict';

const { resolveTenantOrOrganization, applyResolvedTenant } = require('../utils/tenantResolution');

/**
 * PUBLIC_INTERFACE
 * requireTenant
 * Ensures a tenantId is present from one of the allowed sources and attaches it to req.tenantId and req.organizationId.
 * Precedence:
 *   1) JWT (req.auth.tenantId) when present — cannot be overridden.
 *   2) Header x-organization-id | x-org-id | x-tenant-id | x-tenant | organization_id
 *   3) Query ?tenant_id=... or ?organization_id=...
 *   4) Body organization_id (writes)
 * On failure, responds with 400.
 *
 * Notes:
 * - The resolved tenant is mirrored to req.auth.tenantId, req.tenantId, and req.organizationId for downstream usage.
 * - Controllers/services MUST ignore any client-sent tenant_id/organization_id in the payload and trust req.tenantId.
 * - Header takes precedence over query aliases when both are provided.
 */
function requireTenant(req, res, next) {
  const resolved = resolveTenantOrOrganization(req, { allowJwtOverride: true });

  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';

  if (resolved.tenantId) {
    applyResolvedTenant(req, resolved);
    return next();
  }

  // Demo fallback (no auth and no explicit scope)
  if (!isProd && allowDemo) {
    const fallback = {
      tenantId:
        (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        (process.env.AUTH_DEFAULT_TENANT || 'DEMO'),
      organizationId: null,
      source: 'demo',
    };
    fallback.organizationId = fallback.tenantId;
    applyResolvedTenant(req, fallback);
    return next();
  }

  return res.status(400).json({
    success: false,
    message:
      'Missing tenant scope: include header x-organization-id (preferred) or query ?tenant_id / ?organization_id.',
  });
}

module.exports = { requireTenant };
