'use strict';

const db = require('../config/db');
const { ensureTenantFilter } = require('../utils/tenantFilter');

/**
 * LLM Costs CRUD with tenant enforcement
 */
// PUBLIC_INTERFACE
exports.list = async (req, res) => {
  try {
    const { page, limit, sort, filter } = req.query;
    const { llm_costs } = db.getCollections();
    let parsed = {};
    if (filter) {
      try {
        parsed = JSON.parse(filter);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid filter' });
      }
    }
    const tenantFilter = ensureTenantFilter(parsed, req?.auth?.tenantId);
    let cursor = llm_costs.find(tenantFilter);
    if (sort) cursor = cursor.sort(sort);
    if (page || limit) {
      const p = Math.max(parseInt(page || '1', 10), 1);
      const l = Math.min(Math.max(parseInt(limit || '20', 10), 1), 200);
      const total = await llm_costs.countDocuments(tenantFilter);
      const data = await cursor.skip((p - 1) * l).limit(l).toArray();
      return res.json({ success: true, data, meta: { page: p, limit: l, total } });
    }
    const data = await cursor.toArray();
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// PUBLIC_INTERFACE
exports.create = async (req, res) => {
  try {
    const { llm_costs } = db.getCollections();
    const tenantId = req?.auth?.tenantId;
    if (!tenantId) return res.status(403).json({ success: false, message: 'Tenant required' });
    const payload = { ...(req.body || {}), tenant_id: tenantId };
    const result = await llm_costs.insertOne(payload);
    res.status(201).json({ _id: result.insertedId, ...payload });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// PUBLIC_INTERFACE
exports.getById = async (req, res) => {
  try {
    const { id } = req.params;
    const { llm_costs } = db.getCollections();
    const doc = await llm_costs.findOne(ensureTenantFilter({ _id: db.toObjectId(id) }, req?.auth?.tenantId));
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    res.json(doc);
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// PUBLIC_INTERFACE
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { llm_costs } = db.getCollections();
    const updates = { ...(req.body || {}) };
    delete updates.tenant_id;
    const result = await llm_costs.findOneAndUpdate(
      ensureTenantFilter({ _id: db.toObjectId(id) }, req?.auth?.tenantId),
      { $set: updates },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ success: false, message: 'Not found' });
    res.json(result.value);
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// PUBLIC_INTERFACE
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const { llm_costs } = db.getCollections();
    const result = await llm_costs.findOneAndDelete(ensureTenantFilter({ _id: db.toObjectId(id) }, req?.auth?.tenantId));
    if (!result.value) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};
