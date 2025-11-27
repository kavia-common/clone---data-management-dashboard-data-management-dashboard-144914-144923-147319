// 'use strict';

// /**
//  * PUBLIC_INTERFACE
//  * extractOrganization
//  * Express middleware that extracts the organization identifier from request and attaches it to req.organizationId.
//  * - Prefer header x-organization-id when present, then req.query.tenant_id, then req.query.organization_id, and fallback to req.body.organization_id.
//  *   This supports GET /api/users?organization_id=T0015 scoping via query string.
//  * - If not found, returns 400 with a helpful message
//  * - Optionally maps to tenant_id semantics for code that uses tenant naming
//  *
//  * Exposes:
//  *  - req.organizationId: string
//  *  - req.tenantId: string (alias to organizationId for consistency with existing code)
//  * Notes:
//  *  - Downstream routes must enforce scoping using req.organizationId. Any client-provided organization_id/tenant_id must be ignored in filters.
//  */
// const { isSuperAdmin, normalizeTenantId } = require('../utils/access');

// function isT0000Like(val) {
//   if (!val) return false;
//   const v = String(val).trim().toUpperCase();
//   return /^T0+$/.test(v);
// }

// function extractOrganization() {
//   return function (req, res, next) {
//     const bOrg = typeof req.body?.organization_id === 'string' ? req.body.organization_id.trim() : '';
//     const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
//     const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';
//     const hdrOrg =
//       (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
//       (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
//       (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
//       (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
//       '';

//     // Prefer header, then query, then body to minimize client influence via URL tampering
//     const organizationId = hdrOrg || qTenant || qOrg || bOrg;

//     // Super Admin handling: if no org provided or special T0000 selected, treat as global without 400
//     const sa = isSuperAdmin(req);
//     if (sa && (!organizationId || isT0000Like(organizationId))) {
//       // Set bypass flags; do not attach org/tenant id, and no stamping helpers
//       req.tenantScopeDisabled = true;
//       req.allTenants = true;
//       req.organizationId = undefined;
//       req.tenantId = undefined;
//       req.orgFilter = {};
//       req.buildOrgFilter = () => ({});
//       req.withOrgFilter = (obj) => obj;
//       req.stampOrg = (doc) => doc;
//       try {
//         res.set('X-All-Tenants', 'true');
//         res.set('X-Applied-Tenant', 'all-tenants');
//         res.set('X-Applied-Filter', JSON.stringify({ $match: 'none (super-admin all tenants)' }));
//       } catch {}
//       // continue to next without error
//       if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
//         try {
//           console.debug('[extractOrganization] Super Admin bypass active (global scope)');
//         } catch {}
//       }
//       return next();
//     }

//     if (!organizationId) {
//       return res.status(400).json({
//         success: false,
//         message: 'organization_id is required (provide via header x-organization-id or ?organization_id=...)',
//       });
//     }

//     req.organizationId = String(organizationId);
//     req.tenantId = String(organizationId);

//     // Helpers to enforce server-side scoping
//     req.orgFilter = { tenant_id: req.organizationId };
//     req.buildOrgFilter = (orgId) => ({
//       $or: [
//         { tenant_id: orgId },
//         { organization_id: orgId },
//         { organizationId: orgId },
//       ],
//     });
//     req.withOrgFilter = (obj) => {
//       const o = obj && typeof obj === 'object' ? { ...obj } : {};
//       if (!Object.prototype.hasOwnProperty.call(o, 'tenant_id')) {
//         o.tenant_id = req.organizationId;
//       }
//       return o;
//     };
//     req.stampOrg = (doc) => {
//       if (!doc || typeof doc !== 'object') {return doc;}
//       doc.tenant_id = req.organizationId;
//       doc.organization_id = req.organizationId;
//       doc.organizationId = req.organizationId;
//       return doc;
//     };

//     // Dev logging for traceability
//     if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
//       try {
         
//         console.debug(`[extractOrganization] org=${req.organizationId} method=${req.method} url=${req.originalUrl}`);
//       } catch {}
//     }

//     return next();
//   };
// }

// module.exports = {
//   extractOrganization,
// };

'use strict';

/**
 * PUBLIC_INTERFACE
 * extractOrganization
 * Express middleware that extracts the organization identifier from request and attaches it to req.organizationId.
 * - Prefer header x-organization-id when present, then req.query.tenant_id, then req.query.organization_id,
 *   and fallback to req.body.organization_id.
 * - If Super Admin → force GLOBAL access regardless of org header (bypass tenant filters).
 */

const { isSuperAdmin } = require('../utils/access');

function extractOrganization() {
  return function (req, res, next) {

    // Respect early users bypass for GET /api/users
    const isUsersList = req.method === 'GET' && (req.baseUrl || '').endsWith('/users') && req.path === '/';
    if (isUsersList && (req.tenantScopeDisabled || req.allTenants || req.usersAllTenantsBypass)) {
      try {
        console.log('[extractOrganization] bypass respected for GET /api/users; skipping extraction', {
          tenantScopeDisabled: !!req.tenantScopeDisabled,
          allTenants: !!req.allTenants,
          usersAllTenantsBypass: !!req.usersAllTenantsBypass,
        });
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch {}
      return next();
    }

    // ---------------------------
    // 1️⃣ SUPER ADMIN ALWAYS GLOBAL
    // ---------------------------
    if (isSuperAdmin(req)) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;

      req.organizationId = undefined;
      req.tenantId = undefined;

      // Provide no-filter helpers
      req.orgFilter = {};
      req.buildOrgFilter = () => ({});
      req.withOrgFilter = (obj) => obj;
      req.stampOrg = (doc) => doc;

      try { res.set('X-All-Tenants', 'true'); } catch {}

      if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
        console.debug('[extractOrganization] Super Admin → GLOBAL SCOPE enabled.');
      }
      return next();
    }

    // ---------------------------
    // 2️⃣ NORMAL TENANT USER — Extract org/tenant
    // ---------------------------

    const bodyOrg = typeof req.body?.organization_id === 'string' ? req.body.organization_id.trim() : '';
    const queryTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const queryOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';

    const headerOrg =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';

    // Priority: Header → Query → Body
    const organizationId = headerOrg || queryTenant || queryOrg || bodyOrg;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required (use header x-organization-id or ?organization_id=...)'
      });
    }

    req.organizationId = String(organizationId);
    req.tenantId = String(organizationId);

    // Helpers to enforce scoping for non-admin tenants
    req.orgFilter = { tenant_id: req.organizationId };

    req.buildOrgFilter = (orgId) => ({
      $or: [
        { tenant_id: orgId },
        { organization_id: orgId },
        { organizationId: orgId }
      ]
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

    if (process.env.NODE_ENV !== 'production' || process.env.DEBUG === 'true') {
      console.debug(`[extractOrganization] Tenant scope → ${req.organizationId}`);
    }

    return next();
  };
}

module.exports = { extractOrganization };
