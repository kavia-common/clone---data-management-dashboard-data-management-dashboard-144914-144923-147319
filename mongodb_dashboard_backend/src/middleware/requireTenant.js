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
function requireTenant(req, res, next) {
  // Prefer JWT tenantId if present (cannot be overridden)
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
    if (candidate && String(candidate) !== String(jwtTenant)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
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
    req.auth = req.auth || {};
    req.auth.tenantId = String(resolved);
    req.tenantId = String(resolved);
    req.organizationId = String(resolved);
    try {
      if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
        // eslint-disable-next-line no-console
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
