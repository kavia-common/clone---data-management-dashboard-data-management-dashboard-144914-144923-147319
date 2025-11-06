'use strict';

const { ensureTenantFilter } = require('../utils/tenantFilter');

/**
 * CRUD handlers with strict tenant enforcement.
 * All operations are constrained by req.auth.tenantId and set tenant_id on writes.
 */

// PUBLIC_INTERFACE
function listHandler(model) {
  /** List documents belonging to the current tenant with optional pagination. */
  return async function (req, res) {
    const { page, limit, sort, filter } = req.query;
    let parsedFilter = {};
    if (filter) {
      try {
        parsedFilter = JSON.parse(filter);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }
    const tenantFilter = ensureTenantFilter(parsedFilter, req?.auth?.tenantId);
    const cursor = model.find(tenantFilter);
    if (sort) cursor.sort(sort);
    if (page || limit) {
      const p = Math.max(parseInt(page || '1', 10), 1);
      const l = Math.min(Math.max(parseInt(limit || '20', 10), 1), 200);
      const total = await model.countDocuments(tenantFilter);
      const data = await cursor.skip((p - 1) * l).limit(l);
      return res.json({ success: true, data, meta: { page: p, limit: l, total } });
    }
    const data = await cursor;
    res.json(data);
  };
}

// PUBLIC_INTERFACE
function getByIdHandler(model) {
  /** Retrieve a document by id enforcing tenant_id. */
  return async function (req, res) {
    const id = req.params.id;
    const doc = await model.findOne(ensureTenantFilter({ _id: id }, req?.auth?.tenantId));
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    res.json(doc);
  };
}

// PUBLIC_INTERFACE
function createHandler(model) {
  /** Create document and stamp tenant_id from req.auth.tenantId. */
  return async function (req, res) {
    const tenantId = req?.auth?.tenantId;
    const payload = { ...(req.body || {}), tenant_id: tenantId };
    const created = await model.create(payload);
    res.status(201).json(created);
  };
}

// PUBLIC_INTERFACE
function updateHandler(model) {
  /** Update document within tenant scope; tenant_id cannot be changed. */
  return async function (req, res) {
    const id = req.params.id;
    const tenantId = req?.auth?.tenantId;
    const payload = { ...(req.body || {}) };
    delete payload.tenant_id; // prevent cross-tenant reassignment
    const updated = await model.findOneAndUpdate(
      ensureTenantFilter({ _id: id }, tenantId),
      { $set: { ...payload } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    res.json(updated);
  };
}

// PUBLIC_INTERFACE
function deleteHandler(model) {
  /** Delete document within tenant scope. */
  return async function (req, res) {
    const id = req.params.id;
    const deleted = await model.findOneAndDelete(ensureTenantFilter({ _id: id }, req?.auth?.tenantId));
    if (!deleted) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true });
  };
}

module.exports = {
  listHandler,
  getByIdHandler,
  createHandler,
  updateHandler,
  deleteHandler,
};
