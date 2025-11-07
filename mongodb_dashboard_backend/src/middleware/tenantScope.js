'use strict';

/**
 * PUBLIC_INTERFACE
 * tenantScope
 * Middleware and helpers to enforce request-scoped tenant filtering for Mongo/Mongoose access.
 *
 * Responsibilities:
 * - derive tenantId from req.auth.tenantId and attach a per-request helper req.tenantFilter
 * - provide utilities to:
 *    • filterObject(obj, tenantId) -> returns an object with { ...obj, tenant_id: tenantId } if not present
 *    • filterQuery(query, tenantId) -> adds where('tenant_id').equals(tenantId) to a Mongoose query when not already set
 *    • applyToAggregation(pipeline, tenantId) -> ensures first stage includes {$match:{ tenant_id: tenantId }}
 * - stampCreate(doc, tenantId) -> sets tenant_id on doc if missing (server-side enforcement)
 * - add a debug log per request indicating computed tenant filter
 */

function isMongooseQuery(obj) {
  return !!obj && typeof obj === 'object' && (typeof obj.where === 'function' || typeof obj.find === 'function');
}

// PUBLIC_INTERFACE
function filterObject(obj, tenantId) {
  if (!tenantId) return obj || {};
  const o = obj && typeof obj === 'object' ? { ...obj } : {};
  if (!Object.prototype.hasOwnProperty.call(o, 'tenant_id')) {
    o.tenant_id = tenantId;
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
        query.where('tenant_id').equals(tenantId);
      }
    } catch {
      query.where('tenant_id').equals(tenantId);
    }
  }
  return query;
}

// PUBLIC_INTERFACE
function applyToAggregation(pipeline, tenantId) {
  if (!tenantId) return Array.isArray(pipeline) ? pipeline : [];
  const pl = Array.isArray(pipeline) ? [...pipeline] : [];
  // If first stage is a $match containing tenant_id, keep as-is; else prepend tenant match
  const first = pl[0] || {};
  const hasTenantMatch =
    first &&
    first.$match &&
    Object.prototype.hasOwnProperty.call(first.$match, 'tenant_id');

  if (!hasTenantMatch) {
    pl.unshift({ $match: { tenant_id: tenantId } });
  }
  return pl;
}

// PUBLIC_INTERFACE
function stampCreate(doc, tenantId) {
  if (!doc || typeof doc !== 'object') return doc;
  if (tenantId && !Object.prototype.hasOwnProperty.call(doc, 'tenant_id')) {
    // ignore any client-provided tenant_id, always set to auth tenant
    doc.tenant_id = tenantId;
  }
  return doc;
}

// PUBLIC_INTERFACE
function tenantScope() {
  /**
   * Express middleware to:
   * - attach req.tenantFilter = { tenant_id: req.auth.tenantId } (read-only hint)
   * - attach helper methods to req for easy usage in controllers/services:
   *   req.withTenantFilter(objOrQuery)
   *   req.withTenantAggregation(pipeline)
   *   req.stampTenant(doc)
   * - log the computed tenant filter (debug) for temporary verification
   */
  return function (req, _res, next) {
    const tenantId = req?.auth?.tenantId || req.headers['x-tenant-id'] || req.headers['x-tenant'];
    req.tenantFilter = tenantId ? { tenant_id: String(tenantId) } : {};
    // helpers
    req.withTenantFilter = (objOrQuery) => {
      if (isMongooseQuery(objOrQuery)) return filterQuery(objOrQuery, tenantId);
      return filterObject(objOrQuery || {}, tenantId);
    };
    req.withTenantAggregation = (pipeline) => applyToAggregation(pipeline, tenantId);
    req.stampTenant = (doc) => stampCreate(doc, tenantId);

    // Debug log (temporary)
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        // eslint-disable-next-line no-console
        console.debug(`[tenantScope] ${req.method} ${req.originalUrl} tenantFilter=`, req.tenantFilter);
      } catch {}
    }
    next();
  };
}

module.exports = {
  tenantScope,
  filterObject,
  filterQuery,
  applyToAggregation,
  stampCreate,
};
