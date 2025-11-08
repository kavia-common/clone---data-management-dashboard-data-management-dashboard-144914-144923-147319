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
function filterQuery(query, tenantId) {
  if (!tenantId || !query) return query;
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
function applyToAggregation(pipeline, tenantId) {
  const pl = Array.isArray(pipeline) ? [...pipeline] : [];
  if (!tenantId) return pl;
  const first = pl[0] || {};
  const hasTenantMatch = first && first.$match && Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id');
  if (!hasTenantMatch) {
    pl.unshift({ $match: { tenant_id: String(tenantId) } });
  }
  return pl;
}

// PUBLIC_INTERFACE
function stampCreate(doc, tenantId) {
  if (!doc || typeof doc !== 'object') return doc;
  if (tenantId && !Object.prototype.hasOwnProperty.call(doc, 'tenant_id')) {
    doc.tenant_id = String(tenantId);
  } else if (tenantId && doc.tenant_id && String(doc.tenant_id) !== String(tenantId)) {
    // Prevent cross-tenant writes; always enforce current tenant
    doc.tenant_id = String(tenantId);
  }
  return doc;
}

// PUBLIC_INTERFACE
function tenantScopeEnforcer() {
  return function (req, _res, next) {
    const tid = req?.auth?.tenantId || req.tenantId;
    req.tenantId = tid ? String(tid) : undefined;

    // helpers
    req.tenantFilter = req.tenantId ? { tenant_id: req.tenantId } : {};
    req.withTenantFilter = (objOrQuery) => {
      if (isMongooseQuery(objOrQuery)) return filterQuery(objOrQuery, req.tenantId);
      return filterObject(objOrQuery || {}, req.tenantId);
    };
    req.withTenantAggregation = (pipeline) => applyToAggregation(pipeline, req.tenantId);
    req.stampTenant = (doc) => stampCreate(doc, req.tenantId);

    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        // eslint-disable-next-line no-console
        console.debug(`[tenantScopeEnforcer] ${req.method} ${req.originalUrl} tenantId=${req.tenantId || 'n/a'}`);
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
