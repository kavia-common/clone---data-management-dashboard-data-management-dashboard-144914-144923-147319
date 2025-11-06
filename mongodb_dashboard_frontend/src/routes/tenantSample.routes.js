'use strict';

const express = require('express');
const router = express.Router();

const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { getDb } = require('../config/db');
const { getTenantCollection } = require('../utils/mongoTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/sample/records
 * Demonstrates tenant-scoped find on 'llm_costs' collection.
 * Returns only records for the current tenant, even if the client attempts to filter across tenants.
 */
router.get('/sample/records', verifyAuth, requireTenant, async (req, res) => {
  try {
    const db = getDb();
    const base = db.collection('llm_costs');
    const coll = getTenantCollection(req, base);

    // Optional client filter; tenant-enforced wrapper will scope it.
    const clientFilter = {};
    const results = await coll.find(clientFilter, { projection: { _id: 1, tenant_id: 1, user_id: 1, llm_model: 1, total_cost: 1 } }).toArray();

    return res.json({ success: true, count: results.length, data: results });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to list records', error: err && err.message });
  }
});

/**
 * PUBLIC_INTERFACE
 * POST /api/sample/records
 * Demonstrates tenant-enforced insert; will force payload.tenant_id = req.auth.tenantId and reject mismatch.
 */
router.post('/sample/records', verifyAuth, requireTenant, async (req, res) => {
  try {
    const db = getDb();
    const base = db.collection('llm_costs');
    const coll = getTenantCollection(req, base);

    const payload = req.body || {};
    const result = await coll.insertOne(payload);
    return res.status(201).json({ success: true, id: result.insertedId });
  } catch (err) {
    const code = /tenant/i.test(err.message) ? 403 : 400;
    return res.status(code).json({ success: false, message: err.message });
  }
});

module.exports = router;
