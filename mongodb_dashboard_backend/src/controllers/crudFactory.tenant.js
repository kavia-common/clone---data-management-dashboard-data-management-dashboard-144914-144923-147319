'use strict';

const { parsePagination, success, failure } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * Builds a tenant-aware CRUD controller for a given Mongoose Model.
 * All operations are scoped to req.auth.tenantId and will reject when it is missing.
 *
 * Behavior:
 * - list: supports JSON filter, sort, and pagination. If page/limit not provided, returns raw array.
 * - getById: fetches by _id and tenant_id; returns 404 if not found or tenant mismatch.
 * - create: injects tenant_id = req.auth.tenantId into the payload.
 * - update: updates only documents within tenant scope.
 * - remove: deletes only documents within tenant scope.
 *
 * Error handling:
 * - CastError or type casting issues -> 400
 * - ValidationError -> 422
 * - Fallback -> 400
 */
// PUBLIC_INTERFACE
function buildTenantCrudController(Model, listDefaultSort = '-_id') {
  function ensureTenant(req, res) {
    const tenantId = req?.auth?.tenantId;
    if (!tenantId) {
      failure(res, 'Tenant not set in token', 403);
      return null;
    }
    return tenantId;
  }

  function mapAndReplyError(res, err, context = 'operation') {
    const name = err?.name || '';
    const message = err?.message || 'Unknown error';

    if (name === 'CastError' || /Cast to/.test(message)) {
      return failure(res, `Invalid value provided (${context})`, 400, { error: message });
    }
    if (name === 'ValidationError') {
      return failure(res, 'Validation failed', 422, { error: message, details: err?.errors || undefined });
    }
    return failure(res, 'Request failed', 400, { error: message });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      const { page, limit, skip, explicit } = parsePagination(req.query);
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch {
        return failure(res, 'Invalid filter JSON', 400);
      }

      // Enforce tenant scope consistently
      if (Object.prototype.hasOwnProperty.call(filter, 'tenant_id') && filter.tenant_id !== tenantId) {
        return failure(res, 'Tenant mismatch in filter', 400);
      }
      filter.tenant_id = tenantId;

      const sort = req.query.sort || listDefaultSort;

      try {
        if (explicit) {
          const [items, total] = await Promise.all([
            Model.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            Model.countDocuments(filter),
          ]);
          return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
        }

        const items = await Model.find(filter).sort(sort).lean();
        return res.status(200).json(items);
      } catch (err) {
        return mapAndReplyError(res, err, 'list');
      }
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      const { id } = req.params;
      try {
        const doc = await Model.findOne({ _id: id, tenant_id: tenantId }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'getById');
      }
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      try {
        const payload = { ...req.body, tenant_id: tenantId };
        const doc = await Model.create(payload);
        return res.status(201).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'create');
      }
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      const { id } = req.params;
      const data = req.body;
      try {
        // Ensure we only update documents within tenant scope
        const doc = await Model.findOneAndUpdate({ _id: id, tenant_id: tenantId }, data, { new: true }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'update');
      }
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      const tenantId = ensureTenant(req, res);
      if (!tenantId) return;

      const { id } = req.params;
      try {
        const doc = await Model.findOneAndDelete({ _id: id, tenant_id: tenantId }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json({ _id: id });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },
  };
}

module.exports = { buildTenantCrudController };
