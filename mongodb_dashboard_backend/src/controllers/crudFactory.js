'use strict';

const { parsePagination, success, failure } = require('../utils/http');

/**
 * Lightweight micro-cache for list endpoints to coalesce identical rapid requests.
 * Default TTL: 2000ms. Intended to mitigate bursts from quick sort/page toggles.
 * Note: In-memory and per-process only.
 */
const MICRO_CACHE_TTL_MS = parseInt(process.env.MICRO_CACHE_TTL_MS || '2000', 10);
const listMicroCache = new Map(); // key -> { expiresAt:number, payload:any }

/**
 * PUBLIC_INTERFACE
 * Get a micro-cached value if not expired.
 */
function microGet(key) {
  const hit = listMicroCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    listMicroCache.delete(key);
    return null;
  }
  return hit.payload;
}

/**
 * PUBLIC_INTERFACE
 * Set a micro-cached value with TTL.
 */
function microSet(key, payload) {
  listMicroCache.set(key, { payload, expiresAt: Date.now() + MICRO_CACHE_TTL_MS });
}

/**
 * Build a stable cache key for list requests.
 */
function buildListKey(req, filter, sort, page, limit, skip, explicit) {
  // baseUrl+path are stable per router mount; include query-shaping inputs.
  return `list:${req.baseUrl}${req.path}:${JSON.stringify({ filter, sort, page, limit, skip, explicit, tenant_id: req.user?.tenant_id || null })}`;
}

/**
 * Merge a parsed filter with enforced tenant_id if available.
 * For GET list, we AND the tenant_id; for single doc ops we ensure matches include tenant_id.
 */
function withTenantFilter(req, filter = {}) {
  const enforcedTenant = req?.user?.tenant_id;
  if (!enforcedTenant) return filter || {};
  // Never allow client to override tenant_id
  const clean = { ...filter };
  delete clean.tenant_id;
  return { ...clean, tenant_id: enforcedTenant };
}

/**
 * PUBLIC_INTERFACE
 * Build a REST controller for a Mongoose model with tenant scoping.
 * - List: adds tenant filter
 * - GetById: verifies doc.tenant_id matches req.user.tenant_id
 * - Create/Update: forces tenant_id from req.user
 * - Delete: requires doc.tenant_id match
 */
function buildCrudController(Model, listDefaultSort = '-_id') {
  // Map known Mongoose errors to user-friendly responses
  function mapAndReplyError(res, err, context = 'operation') {
    const name = err?.name || '';
    const message = err?.message || 'Unknown error';

    // Invalid _id or filter casting issues
    if (name === 'CastError' || /Cast to/.test(message)) {
      return failure(res, `Invalid value provided (${context})`, 400, { error: message });
    }

    // Schema validation issues when creating/updating
    if (name === 'ValidationError') {
      return failure(res, 'Validation failed', 422, { error: message, details: err?.errors || undefined });
    }

    // Fallback: avoid 500 leaks but still communicate failure
    return failure(res, 'Request failed', 400, { error: message });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      /** List documents with basic JSON filter, pagination, and sort; enforce tenant_id */
      const { page, limit, skip, explicit } = parsePagination(req.query);
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};

      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch (err) {
        return failure(res, 'Invalid filter JSON', 400);
      }

      const sort = req.query.sort || listDefaultSort;

      try {
        const finalFilter = withTenantFilter(req, filter);

        // Micro-cache only explicit (paginated) GET list responses
        if (req.method === 'GET' && explicit) {
          const key = buildListKey(req, finalFilter, sort, page, limit, skip, explicit);
          const cached = microGet(key);
          if (cached) {
            return res.status(200).json(cached);
          }

          const [items, total] = await Promise.all([
            Model.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
            Model.countDocuments(finalFilter),
          ]);

          const payload = { success: true, data: items, meta: { page, limit, total } };
          microSet(key, payload);
          return res.status(200).json(payload);
        }

        // Non-paginated list: return plain array (no envelope)
        const items = await Model.find(finalFilter).sort(sort).lean();
        return res.status(200).json(items);
      } catch (err) {
        return mapAndReplyError(res, err, 'list');
      }
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      const { id } = req.params;
      try {
        const doc = await Model.findById(id).lean();
        if (!doc) return failure(res, 'Not found', 404);
        // Enforce tenant visibility
        const reqTenant = req?.user?.tenant_id || null;
        if (reqTenant && doc.tenant_id && String(doc.tenant_id) !== String(reqTenant)) {
          return failure(res, 'Not found', 404);
        }
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'getById');
      }
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      const data = { ...req.body };
      // Force tenant_id from req.user
      if (req?.user?.tenant_id) {
        data.tenant_id = req.user.tenant_id;
      } else {
        // If token missing tenant_id, deny creation
        return failure(res, 'Tenant context missing', 409);
      }
      try {
        const doc = await Model.create(data);
        return res.status(201).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'create');
      }
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      const { id } = req.params;
      const body = { ...req.body };
      // Never accept tenant_id from body
      delete body.tenant_id;

      try {
        // Load to enforce tenant
        const existing = await Model.findById(id).lean();
        if (!existing) return failure(res, 'Not found', 404);
        const reqTenant = req?.user?.tenant_id || null;
        if (reqTenant && existing.tenant_id && String(existing.tenant_id) !== String(reqTenant)) {
          return failure(res, 'Not found', 404);
        }

        // Apply update & ensure tenant_id stays enforced
        const updateData = reqTenant ? { ...body, tenant_id: reqTenant } : body;
        const doc = await Model.findByIdAndUpdate(id, updateData, { new: true }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'update');
      }
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      const { id } = req.params;
      try {
        // Load then enforce tenant match
        const existing = await Model.findById(id).lean();
        if (!existing) return failure(res, 'Not found', 404);
        const reqTenant = req?.user?.tenant_id || null;
        if (reqTenant && existing.tenant_id && String(existing.tenant_id) !== String(reqTenant)) {
          return failure(res, 'Not found', 404);
        }

        await Model.findByIdAndDelete(id).lean();
        return res.status(200).json({ _id: id });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },
  };
}

module.exports = { buildCrudController };
