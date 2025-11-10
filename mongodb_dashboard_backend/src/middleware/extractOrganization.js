'use strict';

const { resolveTenantOrOrganization, applyResolvedTenant } = require('../utils/tenantResolution');

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Express middleware that extracts the organization identifier from request and attaches it to req.organizationId.
 * Accepts:
 *  - Headers: x-organization-id, x-org-id, x-tenant-id, x-tenant
 *  - Query: organization_id, tenant_id
 *  - Body: organization_id
 * If auth JWT includes a tenant claim, that is preferred and cannot be overridden.
 *
 * Behavior: Do not return 400 when organization_id is provided in the query; resolve and continue.
 */
function extractOrganization() {
  return function (req, res, next) {
    let resolved = resolveTenantOrOrganization(req, { allowJwtOverride: true });

    // If still not resolved, try to read from query or headers permissively
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
      const val = hOrg || qOrg;
      if (val) {
        resolved = { tenantId: String(val), organizationId: String(val), source: hOrg ? 'header' : 'query' };
      }
    }

    if (!resolved.tenantId) {
      return res.status(400).json({
        success: false,
        message:
          'organization_id is required (via header x-organization-id or query ?organization_id / ?tenant_id).',
      });
    }

    applyResolvedTenant(req, resolved);

    // Mirror to req.tenantId as an alias for consistency across code
    if (!req.tenantId) {
      req.tenantId = req.organizationId;
    }

    // Helpers to enforce server-side scoping
    req.orgFilter = { tenant_id: req.organizationId };
    // PUBLIC_INTERFACE
    req.buildOrgFilter = (orgId) => ({
      $or: [{ tenant_id: orgId }, { organization_id: orgId }, { organizationId: orgId }],
    });
    // PUBLIC_INTERFACE
    req.withOrgFilter = (obj) => {
      const o = obj && typeof obj === 'object' ? { ...obj } : {};
      // Strip any client-provided tenant keys and stamp trusted value
      delete o.tenant_id;
      delete o.organization_id;
      delete o.organizationId;
      o.tenant_id = req.organizationId;
      return o;
    };
    // PUBLIC_INTERFACE
    req.stampOrg = (doc) => {
      if (!doc || typeof doc !== 'object') return doc;
      // Overwrite any client-provided tenant hints with trusted scope
      doc.tenant_id = req.organizationId;
      doc.organization_id = req.organizationId;
      doc.organizationId = req.organizationId;
      return doc;
    };

    // Dev logging for traceability
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        // eslint-disable-next-line no-console
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
