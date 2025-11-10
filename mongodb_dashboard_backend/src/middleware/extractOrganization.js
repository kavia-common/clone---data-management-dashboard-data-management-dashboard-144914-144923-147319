'use strict';

const { resolveTenantOrOrganization, applyResolvedTenant } = require('../utils/tenantResolution');

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Express middleware that extracts the organization identifier from request and attaches it to req.organizationId.
 * Accepts:
 *  - JWT claim (preferred): tenantId | tenant_id | organization_id (cannot be overridden)
 *  - Headers: x-organization-id, x-org-id, x-tenant-id, x-tenant
 *  - Query: organization_id, tenant_id
 *  - Body: organization_id or tenant_id
 * If auth JWT includes a tenant claim, that is preferred and cannot be overridden.
 *
 * Behavior: Do not return 400 when organization_id is provided in the query; resolve and continue.
 */
function extractOrganization() {
  return function (req, res, next) {
    let resolved = resolveTenantOrOrganization(req, { allowJwtOverride: true });

    // --- Try permissive fallback if still unresolved ---
    if (!resolved.tenantId) {
      const qOrg =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        '';
      const hOrg =
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers?.['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
        (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        (typeof req.headers?.['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
        '';
      const bOrg =
        (typeof req.body?.organization_id === 'string' && req.body.organization_id.trim()) ||
        (typeof req.body?.tenant_id === 'string' && req.body.tenant_id.trim()) ||
        '';

      const val = hOrg || qOrg || bOrg;
      if (val) {
        resolved = { tenantId: String(val), organizationId: String(val), source: hOrg ? 'header' : qOrg ? 'query' : 'body' };
      }
    }

    if (!resolved.tenantId) {
      return res.status(400).json({
        success: false,
        message:
          'organization_id or tenant_id is required (via header x-organization-id or query/body ?organization_id / tenant_id).',
      });
    }

    // --- Apply the resolved tenant to the request ---
    applyResolvedTenant(req, resolved);

    // --- Ensure aliases for consistency ---
    req.tenantId = req.tenantId || req.organizationId;
    req.organizationId = req.organizationId || req.tenantId;

    // --- Consistent filters and helpers ---
    req.orgFilter = { tenant_id: req.organizationId };

    // PUBLIC_INTERFACE
    req.buildOrgFilter = (orgId) => ({
      $or: [{ tenant_id: orgId }, { organization_id: orgId }, { organizationId: orgId }],
    });

    // PUBLIC_INTERFACE
    req.withOrgFilter = (obj) => {
      const o = obj && typeof obj === 'object' ? { ...obj } : {};
      delete o.tenant_id;
      delete o.organization_id;
      delete o.organizationId;
      o.tenant_id = req.organizationId;
      o.organization_id = req.organizationId;
      return o;
    };

    // PUBLIC_INTERFACE
    req.stampOrg = (doc) => {
      if (!doc || typeof doc !== 'object') return doc;
      doc.tenant_id = req.organizationId;
      doc.organization_id = req.organizationId;
      doc.organizationId = req.organizationId;
      return doc;
    };

    // --- Debug trace ---
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        console.debug(
          `[extractOrganization] org=${req.organizationId} source=${resolved.source} ${req.method} ${req.originalUrl}`
        );
      } catch {}
    }

    return next();
  };
}

module.exports = {
  extractOrganization,
};
