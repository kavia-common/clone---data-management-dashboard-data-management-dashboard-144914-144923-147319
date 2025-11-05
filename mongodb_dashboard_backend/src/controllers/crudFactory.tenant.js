'use strict';

const { failure } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * Ensures a query object contains the current tenant filter and does not attempt to override it.
 */
function withTenantFilter(req, base = {}) {
  if (!req.auth?.tenantId) throw new Error('Missing tenant context');
  if (Object.prototype.hasOwnProperty.call(base, 'tenant_id') && base.tenant_id !== req.auth.tenantId) {
    throw new Error('Tenant mismatch in query');
  }
  return { ...base, tenant_id: req.auth.tenantId };
}

/**
 * PUBLIC_INTERFACE
 * Enforce tenant on a create/update payload; prevents cross-tenant writes.
 */
function enforceTenantOnPayload(req, payload = {}) {
  if (!req.auth?.tenantId) throw new Error('Missing tenant context');
  if (Object.prototype.hasOwnProperty.call(payload, 'tenant_id') && payload.tenant_id !== req.auth.tenantId) {
    throw new Error('Tenant mismatch in payload');
  }
  return { ...payload, tenant_id: req.auth.tenantId };
}

/**
 * PUBLIC_INTERFACE
 * Build a tenant-enforced CRUD controller for a Mongoose Model.
 * The returned handlers expect verifyAuth + requireTenant applied in the route chain.
 */
function buildTenantCrudController(Model, listDefaultSort = '-_id') {
  function mapAndReplyError(res, err, context = 'operation') {
    const msg = err?.message || 'Request failed';
    const status = /tenant/i.test(msg) ? 403 : (err?.name === 'CastError' ? 400 : 400);
    return failure(res, msg, status, { context });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      const explicit = Object.prototype.hasOwnProperty.call(req.query, 'page') || Object.prototype.hasOwnProperty.call(req.query, 'limit');
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || req.query.pageSize, 10) || 20, 1), 200);
      const skip = (page - 1) * limit;
      const sort = req.query.sort || listDefaultSort;

      let filter = {};
      try {
        const raw = req.query.filter ? req.query.filter : '{}';
        filter = typeof raw === 'string' ? JSON.parse(raw) : raw;
        filter = withTenantFilter(req, filter);
      } catch (e) {
        return failure(res, e.message || 'Invalid filter JSON', /tenant/i.test(e.message) ? 403 : 400);
      }

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
      try {
        const filter = withTenantFilter(req, { _id: req.params.id });
        const doc = await Model.findOne(filter).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'getById');
      }
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      try {
        const payload = enforceTenantOnPayload(req, req.body || {});
        const doc = await Model.create(payload);
        return res.status(201).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'create');
      }
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      try {
        const filter = withTenantFilter(req, { _id: req.params.id });
        const payload = enforceTenantOnPayload(req, req.body || {});
        const doc = await Model.findOneAndUpdate(filter, payload, { new: true }).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'update');
      }
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      try {
        const filter = withTenantFilter(req, { _id: req.params.id });
        const doc = await Model.findOneAndDelete(filter).lean();
        if (!doc) return failure(res, 'Not found', 404);
        return res.status(200).json({ _id: String(doc._id) });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },

    verifyAuth,
    requireTenant,
  };
}

module.exports = { buildTenantCrudController, withTenantFilter, enforceTenantOnPayload, verifyAuth, requireTenant };
