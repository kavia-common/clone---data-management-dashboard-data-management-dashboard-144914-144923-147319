'use strict';

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Express middleware that extracts the organization identifier from request and attaches it to req.organizationId.
 * - Prefer req.query.tenant_id. Backward compatibility: also checks req.query.organization_id and headers x-organization-id, x-org-id, x-tenant-id, x-tenant.
 * - If not found, returns 400 with a helpful message
 * - Optionally maps to tenant_id semantics for code that uses tenant naming
 *
 * Exposes:
 *  - req.organizationId: string
 *  - req.tenantId: string (alias to organizationId for consistency with existing code)
 * Notes:
 *  - Downstream routes must enforce scoping using req.organizationId. Any client-provided organization_id/tenant_id must be ignored in filters.
 */
function extractOrganization() {
  return function (req, res, next) {
    const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';
    const hdrOrg =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';

    const organizationId = qTenant || qOrg || hdrOrg;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required (provide as ?organization_id=... or header x-organization-id).',
      });
    }

    req.organizationId = String(organizationId);
    // For compatibility with existing tenant-named helpers
    req.tenantId = String(organizationId);

    // Build common helpers for filtering/stamping to avoid cross-organization data leakage.
    // These helpers mirror tenantScopeEnforcer style, but keyed on tenant_id field at DB level.
    // Note: Some collections may use organization_id or organizationId; callers should OR-match those if needed.
    req.orgFilter = { tenant_id: req.organizationId };
    req.withOrgFilter = (obj) => {
      const o = obj && typeof obj === 'object' ? { ...obj } : {};
      if (!Object.prototype.hasOwnProperty.call(o, 'tenant_id')) {
        o.tenant_id = req.organizationId;
      }
      return o;
    };
    req.stampOrg = (doc) => {
      if (!doc || typeof doc !== 'object') return doc;
      // Always enforce stamp to prevent cross-tenant writes
      doc.tenant_id = req.organizationId;
      return doc;
    };

    return next();
  };
}

module.exports = {
  extractOrganization,
};
