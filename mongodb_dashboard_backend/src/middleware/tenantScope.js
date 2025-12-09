"use strict";

/**
 * Helper utilities for tenant/organization scoping.
 * This is a minimal non-middleware helper used by routes needing dynamic scoping.
 */

// PUBLIC_INTERFACE
function resolveOrganizationIdFromRequest(req) {
  /**
   * Determine the effective tenant/organization identifier from:
   *  - req.auth.tenantId (when auth middleware sets it)
   *  - 'x-organization-id' header
   *  - query params: tenant_id or organization_id
   * Returns a string or null.
   */
  if (req && req.auth && req.auth.tenantId) return String(req.auth.tenantId);
  if (req && typeof req.header === "function") {
    const hdr = req.header("x-organization-id");
    if (hdr) return String(hdr);
  }
  const q = (req && req.query) || {};
  if (q.tenant_id) return String(q.tenant_id);
  if (q.organization_id) return String(q.organization_id);
  return null;
}

module.exports = {
  resolveOrganizationIdFromRequest,
};
