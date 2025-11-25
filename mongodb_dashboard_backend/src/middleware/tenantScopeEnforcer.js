'use strict';

/**
 * PUBLIC_INTERFACE
 * tenantScopeEnforcer
 * Express middleware to enforce tenant-aware access on all DB interactions.
 * - Requires req.auth.tenantId (use with verifyAuth + requireTenant).
 * - Attaches:
 *    req.tenantId: string (canonical tenant id)
 *    req.tenantFilter(obj?): ensured { ...obj, tenant_id: tenantId }
 *    req.withTenantFilter(objOrMongooseQuery): adds tenant filter to plain objects or Mongoose queries
 *    req.withTenantAggregation(pipeline): prepends {$match:{tenant_id}} if not present
 *    req.stampTenant(doc): sets tenant_id on new documents
 * - Provides guard logs in dev to trace tenant behavior.
 */

function isMongooseQuery(obj) {
  return !!obj && typeof obj === 'object' && (typeof obj.where === 'function' || typeof obj.find === 'function');
}

// PUBLIC_INTERFACE
function filterObject(obj, tenantId) {
  const o = obj && typeof obj === 'object' ? { ...obj } : {};
  if (tenantId && !Object.prototype.hasOwnProperty.call(o, 'tenant_id')) {
    o.tenant_id = String(tenantId);
  }
  return o;
}

// PUBLIC_INTERFACE
function filterQuery(query, tenantId, req) {
  if (!query) {return query;}
  if (req && (req.tenantScopeDisabled || req.allTenants)) { return query; }
  if (!tenantId) {return query;}
  if (isMongooseQuery(query)) {
    try {
      const existing = query.getQuery ? query.getQuery() : {};
      if (!('tenant_id' in (existing || {}))) {
        query.where('tenant_id').equals(String(tenantId));
      }
    } catch {
      query.where('tenant_id').equals(String(tenantId));
    }
  }
  return query;
}

// PUBLIC_INTERFACE
function applyToAggregation(pipeline, tenantId, req) {
  const pl = Array.isArray(pipeline) ? [...pipeline] : [];
  if (req && (req.tenantScopeDisabled || req.allTenants)) { return pl; }
  if (!tenantId) {return pl;}
  const first = pl[0] || {};
  const hasTenantMatch = first && first.$match && Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id');
  if (!hasTenantMatch) {
    pl.unshift({ $match: { tenant_id: String(tenantId) } });
  }
  return pl;
}

// PUBLIC_INTERFACE
function stampCreate(doc, tenantId, req) {
  if (!doc || typeof doc !== 'object') {return doc;}
  if (req && (req.tenantScopeDisabled || req.allTenants)) { return doc; }
  if (tenantId && !Object.prototype.hasOwnProperty.call(doc, 'tenant_id')) {
    doc.tenant_id = String(tenantId);
  } else if (tenantId && doc.tenant_id && String(doc.tenant_id) !== String(tenantId)) {
    doc.tenant_id = String(tenantId);
  }
  return doc;
}

// PUBLIC_INTERFACE
function tenantScopeEnforcer() {
  return function (req, res, next) {
    const isUsersList = req.method === 'GET' && (req.baseUrl || '').endsWith('/users') && req.path === '/';

    if ((req.tenantScopeDisabled || req.allTenants) || (isUsersList && req.usersAllTenantsBypass)) {
      // Bypass: do not enforce tenant (covers Super Admin and users route T0000 bypass)
      if (isUsersList && req.usersAllTenantsBypass) {
        try {
          console.log('[tenantScopeEnforcer] bypass respected for GET /api/users (T0000/usersAllTenantsBypass=true)');
          res.set('X-All-Tenants', 'true');
          res.set('X-Applied-Tenant', 'all-tenants');
        } catch {}
      }
      req.tenantId = undefined;
      req.tenantFilter = {};
      req.withTenantFilter = (objOrQuery) => objOrQuery;
      req.withTenantAggregation = (pipeline) => (Array.isArray(pipeline) ? pipeline : []);
      req.stampTenant = (doc) => doc;
      try { if (res && typeof res.set === 'function') { res.set('X-All-Tenants', 'true'); } } catch {}
      return next();
    }

    const tid = req?.auth?.tenantId || req.tenantId;
    req.tenantId = tid ? String(tid) : undefined;

    // helpers
    req.tenantFilter = req.tenantId ? { tenant_id: req.tenantId } : {};
    req.withTenantFilter = (objOrQuery) => {
      if (isMongooseQuery(objOrQuery)) {return filterQuery(objOrQuery, req.tenantId, req);}
      return filterObject(objOrQuery || {}, req.tenantId);
    };
    req.withTenantAggregation = (pipeline) => applyToAggregation(pipeline, req.tenantId, req);
    req.stampTenant = (doc) => stampCreate(doc, req.tenantId, req);

    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        console.debug(`[tenantScopeEnforcer] ${req.method} ${req.originalUrl} tenantId=${req.tenantId || 'n/a'} allTenants=${!!req.allTenants}`);
      } catch {}
    }
    next();
  };
}

module.exports = {
  tenantScopeEnforcer,
  filterObject,
  filterQuery,
  applyToAggregation,
  stampCreate,
};
