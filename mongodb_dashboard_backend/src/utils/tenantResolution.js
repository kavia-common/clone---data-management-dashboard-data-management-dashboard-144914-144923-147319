'use strict';

/**
 * PUBLIC_INTERFACE
 * resolveTenantOrOrganization
 * Resolves the tenant/organization identifier from a request using consistent precedence and aliases.
 *
 * Sources (in order of precedence):
 *   1) JWT claim (req.auth.tenantId) when allowJwtOverride=true (default true), cannot be overridden by client hints.
 *   2) Headers: x-organization-id, x-org-id, x-tenant-id, x-tenant, organization_id
 *   3) Query: tenant_id, organization_id
 *   4) Body: organization_id (used for POST/PUT stamping when appropriate)
 *
 * Returns an object:
 *   {
 *     tenantId: string|null,
 *     organizationId: string|null,    // same value as tenantId for consistency
 *     source: 'jwt'|'header'|'query'|'body'|null
 *   }
 *
 * Notes:
 * - Header takes precedence over query/body when JWT tenant is not present or allowJwtOverride=false.
 * - Callers should mirror tenantId to req.tenantId and req.organizationId for consistency.
 */
function resolveTenantOrOrganization(req, { allowJwtOverride = true } = {}) {
  if (!req || typeof req !== 'object') {
    return { tenantId: null, organizationId: null, source: null };
  }

  // 1) JWT tenant claim
  const jwtTenant = req?.auth?.tenantId ? String(req.auth.tenantId).trim() : '';
  if (allowJwtOverride && jwtTenant) {
    return { tenantId: jwtTenant, organizationId: jwtTenant, source: 'jwt' };
  }

  // 2) Headers (most explicit client scope)
  const hdr =
    (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers?.['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
    (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    (typeof req.headers?.['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
    '';

  if (hdr) {
    const val = String(hdr);
    return { tenantId: val, organizationId: val, source: 'header' };
  }

  // 3) Query
  const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || '';
  const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
  if (qTenant || qOrg) {
    const val = String(qTenant || qOrg);
    return { tenantId: val, organizationId: val, source: 'query' };
  }

  // 4) Body (least preferred; used mainly for stamping on writes)
  const bOrg = (typeof req.body?.organization_id === 'string' && req.body.organization_id.trim()) || '';
  if (bOrg) {
    const val = String(bOrg);
    return { tenantId: val, organizationId: val, source: 'body' };
  }

  return { tenantId: null, organizationId: null, source: null };
}

/**
 * PUBLIC_INTERFACE
 * applyResolvedTenant
 * Applies a resolved tenant to the request: sets req.tenantId, req.organizationId, and mirrors into req.auth.tenantId.
 */
function applyResolvedTenant(req, resolved) {
  if (!req || !resolved) return;
  const { tenantId } = resolved;
  if (!tenantId) return;

  req.tenantId = String(tenantId);
  req.organizationId = String(tenantId);
  req.auth = req.auth || {};
  if (!req.auth.tenantId) {
    req.auth.tenantId = String(tenantId);
  }
}

module.exports = {
  resolveTenantOrOrganization,
  applyResolvedTenant,
};
