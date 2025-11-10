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
 */
function extractOrganization() {
  return function (req, res, next) {
    const resolved = resolveTenantOrOrganization(req, { allowJwtOverride: true });

    if (!resolved.tenantId) {
      return res.status(400).json({
        success: false,
        message:
          'organization_id is required (via header x-organization-id or query ?organization_id / ?tenant_id).',
      });
    }

    applyResolvedTenant(req, resolved);

    // Helpers to enforce server-side scoping
    req.orgFilter = { tenant_id: req.organizationId };
    req.buildOrgFilter = (orgId) => ({
      $or: [{ tenant_id: orgId }, { organization_id: orgId }, { organizationId: orgId }],
    });
    req.withOrgFilter = (obj) => {
      const o = obj && typeof obj === 'object' ? { ...obj } : {};
      if (!Object.prototype.hasOwnProperty.call(o, 'tenant_id')) {
        o.tenant_id = req.organizationId;
      }
      return o;
    };
    req.stampOrg = (doc) => {
      if (!doc || typeof doc !== 'object') return doc;
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
