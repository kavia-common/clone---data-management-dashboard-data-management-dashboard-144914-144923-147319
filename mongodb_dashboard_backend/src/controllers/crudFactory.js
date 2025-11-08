const { parsePagination, success, failure } = require('../utils/http');
const { applyTenantFilter } = require('../middleware/authTenant');

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
  return `list:${req.baseUrl}${req.path}:${JSON.stringify({ filter, sort, page, limit, skip, explicit })}`;
}

/**
 * Build a REST controller for a Mongoose model.
 * Supports list with basic filtering, get by id, create, update, delete.
 * Adds tenant-aware filtering/stamping using req.auth.tenantId when present.
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

    // Fallback
    return failure(res, 'Request failed', 400, { error: message });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      /** List documents with basic JSON filter, pagination, and sort */
      const { page, limit, skip, explicit } = parsePagination(req.query);
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch (_err) {
        return failure(res, 'Invalid filter JSON', 400);
      }

      // Enforce tenant scoping
      if (req.auth?.tenantId) {
        filter = applyTenantFilter(filter, req.auth.tenantId);
      }

      // If a route-level forcedFilter exists (e.g., sessionTrackingScope), override tenant_id/user_id
      if (req.forcedFilter && typeof req.forcedFilter === 'object') {
        // Never allow client to broaden tenant_id or user_id
        const enforced = { ...filter };
        if (req.forcedFilter.tenant_id != null) enforced.tenant_id = String(req.forcedFilter.tenant_id);
        if (req.forcedFilter.user_id != null) enforced.user_id = String(req.forcedFilter.user_id);
        filter = enforced;
      }

      const sort = req.query.sort || listDefaultSort;

      try {
        // Micro-cache only explicit (paginated) GET list responses
        if (req.method === 'GET' && explicit) {
          const key = buildListKey(req, filter, sort, page, limit, skip, explicit);
          const cached = microGet(key);
          if (cached) {
            return res.status(200).json(cached);
          }

          const [items, total] = await Promise.all([
            Model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            Model.countDocuments(filter),
          ]);
          const payload = { success: true, data: items, meta: { page, limit, total } };
          microSet(key, payload);
          return res.status(200).json(payload);
        }

        // No explicit pagination: return the raw array of documents (no envelope)
        const items = await Model.find(filter).sort(sort).lean();
        return res.status(200).json(items);
      } catch (err) {
        return mapAndReplyError(res, err, 'list');
      }
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      /** Get a single document by Mongo _id */
      const { id } = req.params;
      try {
        let criteria = { _id: id };
        if (req.auth?.tenantId) {
          criteria = applyTenantFilter(criteria, req.auth.tenantId);
        }
        // If forcedFilter applies, ensure both tenant_id and user_id are enforced in lookup
        if (req.forcedFilter && typeof req.forcedFilter === 'object') {
          if (req.forcedFilter.tenant_id != null) criteria.tenant_id = String(req.forcedFilter.tenant_id);
          if (req.forcedFilter.user_id != null) criteria.user_id = String(req.forcedFilter.user_id);
        }
        const doc = await Model.findOne(criteria).lean();
        if (!doc) return failure(res, 'Not found', 404);
        // Return raw doc
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'getById');
      }
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      /** Create a new document */
      const data = req.body || {};
      try {
        if (req.auth?.tenantId && data && typeof data === 'object' && data.tenant_id == null) {
          data.tenant_id = req.auth.tenantId;
        }
        const doc = await Model.create(data);
        // Return raw created doc
        return res.status(201).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'create');
      }
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      /** Update a document by _id with provided data */
      const { id } = req.params;
      const data = req.body || {};
      try {
        let doc;
        // Build criteria with tenant and optionally user constraint
        let criteria = { _id: id };
        if (req.auth?.tenantId) criteria.tenant_id = req.auth.tenantId;
        if (req.forcedFilter && typeof req.forcedFilter === 'object') {
          if (req.forcedFilter.tenant_id != null) criteria.tenant_id = String(req.forcedFilter.tenant_id);
          if (req.forcedFilter.user_id != null) criteria.user_id = String(req.forcedFilter.user_id);
        }
        doc = await Model.findOneAndUpdate(criteria, data, { new: true }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'update');
      }
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      /** Delete a document by _id */
      const { id } = req.params;
      try {
        let criteria = { _id: id };
        if (req.auth?.tenantId) criteria.tenant_id = req.auth.tenantId;
        if (req.forcedFilter && typeof req.forcedFilter === 'object') {
          if (req.forcedFilter.tenant_id != null) criteria.tenant_id = String(req.forcedFilter.tenant_id);
          if (req.forcedFilter.user_id != null) criteria.user_id = String(req.forcedFilter.user_id);
        }
        const doc = await Model.findOneAndDelete(criteria).lean();
        if (!doc) return failure(res, 'Not found', 404);
        // Return minimal raw response indicating deleted id
        return res.status(200).json({ _id: id });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },
  };
}

module.exports = { buildCrudController };
