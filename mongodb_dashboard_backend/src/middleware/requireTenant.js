'use strict';

/**
 * PUBLIC_INTERFACE
 * requireTenant
 * Ensures a tenantId is present from one of the allowed sources and attaches it to req.tenantId.
 * Precedence:
 *   1) JWT (req.auth.tenantId) when present — cannot be overridden.
 *   2) Header x-organization-id | x-tenant-id | x-tenant (also accepts organization_id header)
 *   3) Query ?tenant_id=... or legacy ?organization_id=...
 *   4) Demo fallback (non-prod with ALLOW_DEMO_AUTH=true) may accept header or query.
 * On failure, responds with 400.
 *
 * Notes:
 * - The resolved tenant is mirrored to req.auth.tenantId and req.tenantId for downstream usage.
 * - Controllers/services MUST ignore any client-sent tenant_id/organization_id in the payload and trust req.tenantId.
 * - Header takes precedence over query aliases when both are provided.
 */
const { isSuperAdmin, normalizeTenantId } = require('../utils/access');

/**
 * Normalize a raw tenant/org id and treat special "T0000" (or equivalent zeros) as global for Super Admin.
 */
function normalizeIncomingTenant(id) {
  if (!id) return '';
  const n = normalizeTenantId(id);
  // Collapse common "T0000" style to a canonical form for equality checks
  // For Super Admin we will treat this as "global/all-tenants"
  if (typeof n === 'string' && /^T0+$/i.test(n)) {
    return 'T0';
  }
  return n;
}

function parseAllTenantsFlag(req) {
  const hdr = String(req.headers['x-all-tenants'] || '').toLowerCase().trim();
  const q = String(req.query?.all_tenants || '').toLowerCase().trim();
  const truthy = ['1', 'true', 'yes', 'on'];
  return truthy.includes(hdr) || truthy.includes(q);
}

function requireTenant(req, res, next) {
  // Determine if all-tenants mode is requested and user is Super Admin
  const wantsAll = parseAllTenantsFlag(req);
  const isSA = isSuperAdmin(req);

  // If incoming indicates special T0000/T0 choice in headers/query/body, normalize it
  const incomingAny =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
    (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
    (typeof req.body?.tenant_id === 'string' && req.body.tenant_id.trim()) ||
    (typeof req.body?.organization_id === 'string' && req.body.organization_id.trim()) ||
    '';

  const normalizedIncomingAny = normalizeIncomingTenant(incomingAny);

  // Super Admin bypass:
  // - If explicitly requested all tenants OR selected special T0000/T0, ignore incoming tenant hints altogether
  if (isSA && (wantsAll || normalizedIncomingAny === 'T0')) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    // Clear any derived tenant scoping to avoid accidental stamping
    req.tenantId = undefined;
    if (req.auth) {
      req.auth.tenantId = undefined;
    }
    try {
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
      res.set('X-Applied-Filter', JSON.stringify({ $match: 'none (super-admin all tenants)' }));
    } catch (_) {}
    return next();
  }

  // Prefer JWT tenantId if present (cannot be overridden) - but do not enforce conflicts for Super Admin
  const jwtTenant = req?.auth?.tenantId;
  if (jwtTenant) {
    // When JWT is present, ensure any explicit client-provided tenant does not conflict
    const hdrCandidate =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) || '';
    const qCandidate =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
    const candidate = hdrCandidate || qCandidate;
    const nCandidate = candidate ? normalizeTenantId(candidate) : null;
    const nJwt = normalizeTenantId(jwtTenant);
    if (nCandidate && String(nCandidate) !== String(nJwt)) {
      // For Super Admin, do not enforce mismatch; we will ignore incoming hints and stay with JWT tenant unless bypass flagged elsewhere
      if (!isSA) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
    }
    req.tenantId = String(jwtTenant);
    req.organizationId = String(jwtTenant);
    try { 
      res.set('X-Applied-Tenant', String(jwtTenant)); 
      const tenant = String(jwtTenant);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      }));
    } catch (_) {}
    return next();
  }

  // Extract tenant from headers and query for non-JWT flows
  const hdrTenant =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
    (typeof req.headers['organization_id'] === 'string' && req.headers['organization_id'].trim()) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
    '';

  // Accept query parameters for tenant resolution (preferred: tenant_id; legacy alias: organization_id)
  const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || '';
  const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
  const qAlias = qTenant || qOrg;

  // Precedence: JWT > header > query (tenant_id | organization_id)
  const resolved = hdrTenant || qAlias;

  const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const allowDemo = String(process.env.ALLOW_DEMO_AUTH || '').toLowerCase() === 'true';

  if (resolved) {
    // If no JWT, accept header/query provided tenant
    // Super Admin: still accept a concrete tenant if they are operating within a tenant (not bypass); however, ignore T0000 and treat as global
    const normalizedResolved = normalizeIncomingTenant(resolved);
    req.auth = req.auth || {};
    if (isSA && normalizedResolved === 'T0') {
      // treat as global (no scoping)
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.auth.tenantId = undefined;
      req.tenantId = undefined;
      req.organizationId = undefined;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
        res.set('X-Applied-Filter', JSON.stringify({ $match: 'none (super-admin all tenants)' }));
      } catch (_) {}
      return next();
    }
    req.auth.tenantId = String(resolved);
    req.tenantId = String(resolved);
    req.organizationId = String(resolved);
    try {
      if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
         
        console.debug('[requireTenant] resolved from header/query ->', String(resolved));
      }
    } catch {}
    try { 
      res.set('X-Applied-Tenant', String(resolved)); 
      const tenant = String(resolved);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      }));
    } catch (_) {}
    return next();
  }

  // Demo fallback (no JWT, no header/query). Allow using default or block based on settings.
  if (!isProd && allowDemo) {
    const demoTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      (process.env.AUTH_DEFAULT_TENANT || 'DEMO');
    req.auth = req.auth || {};
    req.auth.tenantId = String(demoTenant);
    req.tenantId = String(demoTenant);
    req.organizationId = String(demoTenant);
    try { 
      res.set('X-Applied-Tenant', String(demoTenant)); 
      const tenant = String(demoTenant);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      }));
    } catch (_) {}
    return next();
  }

  return res.status(400).json({
    success: false,
    message:
      'Missing tenant scope: include header x-organization-id (preferred) or query ?tenant_id (legacy: ?organization_id).',
  });
}

module.exports = { requireTenant };
