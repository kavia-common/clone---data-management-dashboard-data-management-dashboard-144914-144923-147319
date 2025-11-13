'use strict';

/**
 * PUBLIC_INTERFACE
 * organizationExtractor
 *
 * Permissive global organization/tenant extractor.
 * - Reads x-organization-id header (preferred) OR query ?organization_id OR ?tenant_id
 * - If present, sets:
 *     req.organizationId (canonical)
 *     req.tenantId (alias)
 *     req.context.organizationId (when context exists)
 * - Does NOT throw 400 if missing.
 * - Always echoes the resolved value back via response header 'x-organization-id' when present.
 */
function organizationExtractor() {
  return function (req, res, next) {
    try {
      const hdr =
        (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        null;
      const qOrg =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || null;
      const qTenant =
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || null;

      // Precedence: header > organization_id > tenant_id
      const resolved = hdr || qOrg || qTenant || req.organizationId || req.tenantId || null;

      if (!req.context) req.context = {};

      if (resolved) {
        const id = String(resolved);
        req.organizationId = id;
        req.tenantId = id;
        req.context.organizationId = id;
        try {
          res.set('x-organization-id', id);
        } catch (_) {}
      }
    } catch (_) {
      // swallow extractor errors; keep behavior permissive
    } finally {
      return next();
    }
  };
}

module.exports = { organizationExtractor };
