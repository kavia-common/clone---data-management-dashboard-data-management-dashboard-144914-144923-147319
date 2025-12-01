/**
 * PUBLIC_INTERFACE
 * LLM Costs routes
 * GET / -> tenant-scoped listing with pagination and projections
 */
const express = require('express');
const router = express.Router();

const { listLLMCostsStd } = require('../controllers/llmCosts.list.controller');

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs
 * Returns paginated LLM cost records with standard envelope:
 * { data, page, limit, total, hasMore }
 * Headers include X-Request-Id, X-Route-Timing, and X-Applied-Tenant when applicable.
 */
const { dbReadyOr503 } = require('../middleware/dbReadiness');
router.get('/', dbReadyOr503, listLLMCostsStd);

const { getDb } = require('../config/db');

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs/_diagnostics
 * Admin-only diagnostics: counts by organization_id and a small sample.
 * Use header x-organization-id or query ?organization_id or ?tenant_id to scope.
 */
router.get('/_diagnostics', async (req, res) => {
  const started = Date.now();
  try {
    // Only allow for super admin or when explicit admin bypass header is set
    const isSuperAdmin = !!(req.user && req.user.isSuperAdmin);
    const adminHeader = String(req.headers['x-admin-diagnostics'] || '').toLowerCase().trim() === 'true';
    if (!isSuperAdmin && !adminHeader) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const mongoose = require('mongoose');
    const { getDb, isDbConnected } = require('../config/db');

    if (!process.env.MONGODB_URI) {
      return res.status(503).json({ success: false, error: 'Database not configured' });
    }

    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch {}
    }
    const db = await getDb();

    // Resolve collection name dynamically
    let collection = db.collection('llm-costs');
    try {
      const names = await db.listCollections({}, { nameOnly: true }).toArray();
      const nameSet = new Set(names.map(n => n.name));
      if (nameSet.has('llm-costs')) collection = db.collection('llm-costs');
      else if (nameSet.has('llm_costs')) collection = db.collection('llm_costs');
    } catch {}

    const tenant = req.tenantId || req.organizationId || req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || undefined;
    const filter = tenant ? { organization_id: String(tenant) } : {};

    const total = await collection.countDocuments(filter);
    const sample = await collection
      .find(filter, { projection: { _id: 1, organization_id: 1, createdAt: 1, created_at: 1, timestamp: 1, total_cost: 1 } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(5)
      .toArray();

    // simple index listing
    let indexes = {};
    try { indexes = await collection.indexes(); } catch {}

    try {
      res.set('X-Route-Timing', String(Date.now() - started));
      if (tenant) res.set('X-Applied-Tenant', String(tenant));
    } catch {}

    return res.status(200).json({
      success: true,
      tenant: tenant || null,
      total,
      sample,
      indexes,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Diagnostics failed', detail: String(e?.message || e) });
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/llm-costs/ping
 * A minimal health ping for CI/debugging to quickly validate that /api/llm-costs group is reachable.
 * Returns 200 OK with a timestamp.
 */
router.get('/ping', (req, res) => {
  const started = Date.now();
  try {
    res.set('X-Request-Id', req.traceId || '');
    if (req.tenantId) res.set('X-Applied-Tenant', String(req.tenantId));
  } catch {}
  const body = { ok: true, route: '/api/llm-costs/ping', ts: new Date().toISOString() };
  try { res.set('X-Route-Timing', String(Date.now() - started)); } catch {}
  return res.status(200).json(body);
});

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/_diagnostics/sample
 * Returns a tenant-scoped sample with counts and first few ids/timestamps to validate data presence.
 * Parameters:
 *  - organization_id (alias: tenant_id or header x-organization-id)
 *  - limit (optional, default 5)
 */
router.get('/_diagnostics/sample', async (req, res) => {
  const started = Date.now();
  try {
    const tenant =
      req.query.organization_id ||
      req.query.tenant_id ||
      req.headers['x-organization-id'] ||
      req.tenantId ||
      req.organizationId ||
      null;

    if (!tenant) {
      return res.status(400).json({ success: false, error: 'Missing organization_id (or tenant_id)' });
    }

    const db = await getDb();

    // Detect between 'llm-costs' and 'llm_costs'
    let collection = db.collection('llm-costs');
    try {
      const names = await db.listCollections({}, { nameOnly: true }).toArray();
      const set = new Set(names.map((n) => n.name));
      if (set.has('llm-costs')) collection = db.collection('llm-costs');
      else if (set.has('llm_costs')) collection = db.collection('llm_costs');
    } catch {}

    const org = String(tenant);
    const filter = {
      $or: [
        { organization_id: org },
        { tenant_id: org },
        { organizationId: org },
        { tenantId: org },
        { orgId: org },
        { 'tenant.tenant_id': org },
      ],
    };

    const limit = Math.min(parseInt(req.query.limit || '5', 10) || 5, 20);

    // head sample with safe timeouts
    let sample = [];
    try {
      sample = await collection
        .find(filter, { projection: { _id: 1, organization_id: 1, tenant_id: 1, createdAt: 1, created_at: 1, timestamp: 1, total_cost: 1 } })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .maxTimeMS(3000)
        .toArray();
    } catch {
      // retry without maxTimeMS
      sample = await collection
        .find(filter, { projection: { _id: 1, organization_id: 1, tenant_id: 1, createdAt: 1, created_at: 1, timestamp: 1, total_cost: 1 } })
        .sort({ _id: -1 })
        .limit(limit)
        .toArray();
    }

    let total = 0;
    let totalKnown = true;
    try {
      total = await collection.countDocuments(filter, { maxTimeMS: 8000 });
    } catch {
      totalKnown = false;
      total = (sample || []).length;
    }

    try {
      res.set('X-Route-Timing', String(Date.now() - started));
      res.set('X-Applied-Tenant', org);
    } catch {}
    return res.status(200).json({
      success: true,
      tenant: org,
      total: totalKnown ? total : null,
      totalKnown,
      sample,
      note: totalKnown ? undefined : 'Count timed out; returning sample only',
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Diagnostics sample failed', detail: String(e?.message || e) });
  }
});

module.exports = router;
