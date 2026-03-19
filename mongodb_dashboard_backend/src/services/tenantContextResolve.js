'use strict';

/**
 * Tenant context resolution utility shared by routes/services.
 *
 * Flow name: TenantContextResolutionFlow
 * Single entrypoint for resolving:
 *  - effective tenant id (if any)
 *  - whether request should bypass tenant scoping (all-tenants mode)
 *
 * This avoids patchy duplication of T0000/super-admin/all-tenants logic across endpoints.
 */

/**
 * PUBLIC_INTERFACE
 * isAllTenantsSentinel
 *
 * Contract:
 * - Input: any value (string-ish)
 * - Output: boolean
 * - Sentinel: "T0000" (case-insensitive, whitespace-tolerant)
 */
function isAllTenantsSentinel(value) {
  if (typeof value !== 'string') return false;
  return value.trim().toUpperCase() === 'T0000';
}

/**
 * PUBLIC_INTERFACE
 * resolveTenantContextFromRequest
 *
 * Contract:
 * Inputs:
 * - req: Express request object
 *
 * Outputs:
 * - { bypass:boolean, tenantId:string|null, requestedTenantRaw:string|null }
 *
 * Semantics:
 * - bypass=true when:
 *   - req already indicates bypass (tenantScopeDisabled/allTenants/sessionsAllTenantsBypass)
 *   - user is super admin (req.user.isSuperAdmin)
 *   - OR the requested tenant equals the all-tenants sentinel T0000
 * - tenantId is the resolved tenant identifier, unless bypass=true in which case it is null.
 *
 * Failure modes:
 * - Never throws; caller should still enforce "tenantId required" when bypass=false.
 */
function resolveTenantContextFromRequest(req) {
  const requestedTenantRaw =
    req?.tenantId ||
    (typeof req?.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
    (typeof req?.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
    (typeof req?.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req?.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    null;

  const bypassByFlags = !!(
    req?.tenantScopeDisabled ||
    req?.allTenants ||
    req?.sessionsAllTenantsBypass ||
    req?.user?.isSuperAdmin
  );

  const bypassBySentinel = isAllTenantsSentinel(requestedTenantRaw || '');

  const bypass = bypassByFlags || bypassBySentinel;

  // Important invariant: never leak a literal "T0000" into scoping filters.
  const tenantId = bypass ? null : (requestedTenantRaw ? String(requestedTenantRaw).trim() : null);

  return { bypass, tenantId, requestedTenantRaw: requestedTenantRaw ? String(requestedTenantRaw) : null };
}

module.exports = {
  isAllTenantsSentinel,
  resolveTenantContextFromRequest,
};
