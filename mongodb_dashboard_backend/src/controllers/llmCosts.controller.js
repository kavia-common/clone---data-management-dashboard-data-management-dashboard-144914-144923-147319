'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Deterministic and bounded behavior:
 *  - Fast readiness short-circuit: if DB isn't ready within ~1s or MONGODB_URI missing, returns 503 JSON
 *  - Direct find() on 'llm-costs' with exact organization_id match
 *  - Bounded: maxTimeMS(5000), limit <= 50, stable sort by _id desc
 *  - Projection only required fields to reduce payload
 *  - On Mongo network timeout, return 504 concise JSON
 *  - Adds diagnostic headers: X-DB-Connected, X-Query-Duration, X-Org-Filter
 */
async function listLLMCosts(req, res, next) {
  const start = Date.now();
  try {
    // Env missing: fail fast
    if (!process.env.MONGODB_URI) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      return res.status(503).json({
        success: false,
        error: 'Database not configured',
        detail: 'MONGODB_URI is missing',
      });
    }

    // Readiness check within 1s
    const readiness = await isDBReadyFast(1000);
    if (!readiness.ok) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      return res.status(503).json({
        success: false,
        error: 'Database not ready',
        detail: readiness.reason || 'unknown',
      });
    }

    if (!isDbConnected()) {
      // Attempt to connect just in case, but keep response bounded
      try { await mongoose.connect(process.env.MONGODB_URI); } catch {}
    }

    const db = await getDb();
    const collection = db.collection('llm-costs');

    // Resolve exact tenant filter; required
    const headerTenant = req.headers['x-organization-id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const resolvedTenant = headerTenant || queryTenant;
    if (!resolvedTenant) {
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', '');
      return res.status(400).json({
        success: false,
        error: 'Missing tenant (organization_id). Provide Authorization or x-organization-id header, or ?organization_id',
      });
    }

    const filter = { organization_id: String(resolvedTenant) };
    const sort = { _id: -1 };

    // Limit cap <= 50
    let limit = 20;
    if (req.query.limit) {
      const l = parseInt(req.query.limit, 10);
      if (Number.isFinite(l) && l > 0) limit = l;
    }
    limit = Math.min(limit, 50);

    const page = req.query.page ? parseInt(req.query.page, 10) : 1;
    const hasPagination = Number.isInteger(page) && page >= 1;
    const skip = hasPagination ? (page - 1) * limit : 0;

    // Projection of essential fields
    const projection = {
      _id: 1,
      organization_id: 1,
      project_id: 1,
      user_id: 1,
      type: 1,
      timestamp: 1,
      total_cost: 1,
      organization_cost: 1,
      createdAt: 1,
      created_at: 1,
    };

    let items;
    try {
      const cursor = collection
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(5000);

      items = await cursor.toArray();
    } catch (e) {
      // Query timeout or network failures
      const timedOut =
        e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant);
      res.set('X-Query-Duration', String(Date.now() - start));
      return res.status(timedOut ? 504 : 500).json({
        success: false,
        error: timedOut ? 'Query timed out' : 'Query failed',
      });
    }

    res.set('X-DB-Connected', String(isDbConnected()));
    res.set('X-Org-Filter', resolvedTenant);
    res.set('X-Query-Duration', String(Date.now() - start));

    if (hasPagination) {
      let total = 0;
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: 2000 });
      } catch {
        total = items.length + skip; // fallback estimate
      }
      return res.json({
        success: true,
        data: items,
        meta: { page, limit, total },
      });
    } else {
      return res.json(items);
    }
  } catch (err) {
    try {
      res.set('X-Query-Duration', String(Date.now() - start));
    } catch {}
    next(err);
  }
}

module.exports = {
  listLLMCosts,
};
