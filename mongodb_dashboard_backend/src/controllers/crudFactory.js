const { parsePagination, failure } = require('../utils/http');
const mongoose = require('mongoose');

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
 * This implementation adds robust error handling to avoid runtime 500s for:
 * - CastError (e.g., invalid _id, invalid filter value types)
 * - ValidationError (create/update schema validations)
 *
 * Response format change:
 * - If pagination is NOT explicitly requested (no page/limit query), return RAW MongoDB data:
 *   - list: returns an array of documents directly (no {success,data,meta})
 *   - getById/create/update/remove: return the document or result object directly
 * - If pagination IS explicitly requested, keep envelope { success, data, meta } for backward compatibility.
 */
// PUBLIC_INTERFACE
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
      /** List documents with basic JSON filter, pagination, and sort */
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
        // If pagination explicitly requested, respect pagination and provide envelope + meta
        if (explicit) {
          // Micro-cache only explicit (paginated) GET list responses
          const useCache = req.method === 'GET';
          const key = useCache ? buildListKey(req, filter, sort, page, limit, skip, explicit) : null;
          if (useCache) {
            const cached = microGet(key);
            if (cached) return res.status(200).json(cached);
          }

          const [items, total] = await Promise.all([
            Model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            Model.countDocuments(filter),
          ]);

          if ((process.env.DEBUG_DB_LOGS || '').toString().toLowerCase() === 'true') {
            // eslint-disable-next-line no-console
            console.log(
              `[DB][list] model=${Model.modelName} collection=${Model.collection?.collectionName} db=${mongoose.connection?.name} filter=${JSON.stringify(
                filter
              )} sort=${sort} page=${page} limit=${limit} returned=${items.length} total=${total}`
            );
          }

          const payload = { success: true, data: items, meta: { page, limit, total } };
          if (useCache) microSet(key, payload);
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
        const doc = await Model.findById(id).lean();
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
      const data = req.body;
      try {
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
      const data = req.body;
      try {
        const doc = await Model.findByIdAndUpdate(id, data, { new: true }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        // Return raw updated doc
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
        const doc = await Model.findByIdAndDelete(id).lean();
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
