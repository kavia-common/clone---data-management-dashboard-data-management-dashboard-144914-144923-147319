'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
// PUBLIC_INTERFACE
 * listLLMCostsStd
 * GET /api/llm-costs
 * 
 * This is the primary listing controller for the LLM costs collection.
 * Parameters (query):
 * - organization_id (string) Tenant ID; alias tenant_id. When JWT is provided, token tenant overrides.
 * - page (integer) Page number, default 1
 * - limit (integer) Page size, default 20, max 100
 * 
 * Returns:
 * - 200 JSON: { data: [], page, limit, total, hasMore }
 * - 400 when tenant is missing (unless super admin all-tenants mode)
 * - 429 in case of rate limit
 * - 200 with empty payload if query timed out (graceful degradation)
 */
async function listLLMCostsStd(req, res, next) {
  const t0 = Date.now();

  const MAX_LIMIT = 100;
  const DEFAULT_LIMIT = 20;
  const DEFAULT_PAGE = 1;
  const timeoutCfg = Number.parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '8000', 10);
  const QUERY_TIMEOUT_MS = Number.isFinite(timeoutCfg) && timeoutCfg > 0 ? timeoutCfg : 8000;

  try {
    // Attach correlation and required headers up-front
    try {
      if (req.traceId) res.set('X-Request-Id', req.traceId);
    } catch {}

    // Validate DB configuration
    if (!process.env.MONGODB_URI) {
      // Return fast with standard envelope to avoid 502 bubbles
      return res.status(503).json({
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
        error: 'Database not configured',
      });
    }

    // Fast readiness probe with bounded time
    const readiness = await isDBReadyFast(Math.min(1000, QUERY_TIMEOUT_MS));
    // Compute tenant as early as possible for headers even on readiness failure
    const ctxTenant = req.tenantId || req.organizationId || req.auth?.tenantId;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const organizationId = ctxTenant || headerTenant || queryTenant;

    if (!readiness.ok) {
      try { res.set('X-Applied-Tenant', organizationId ? String(organizationId) : ''); } catch {}
      // Graceful degrade to 200 + empty envelope to keep gateway happy
      return res
        .status(200)
        .json({ data: [], page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, total: 0, hasMore: false, note: 'DB not ready' });
    }

    // Tenant scoping decision (respect SA/all-tenants bypass)
    const isBypass = !!(req.tenantScopeDisabled || req.allTenants);
    if (!organizationId && !isBypass) {
      try { res.set('X-Applied-Tenant', ''); } catch {}
      return res.status(400).json({
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
        error: 'Missing organization_id. Provide via auth tenant, x-organization-id header, or ?organization_id',
      });
    }

    // Pagination setup
    let limit = DEFAULT_LIMIT;
    if (req.query.limit) {
      const l = parseInt(req.query.limit, 10);
      if (Number.isFinite(l) && l > 0) limit = l;
    }
    limit = Math.min(limit, MAX_LIMIT);

    let page = DEFAULT_PAGE;
    if (req.query.page) {
      const p = parseInt(req.query.page, 10);
      if (Number.isFinite(p) && p >= 1) page = p;
    }
    const skip = (page - 1) * limit;

    // Filter on organization_id when available; allow all tenants in SA bypass
    const filter = {};
    if (organizationId && !isBypass) {
      filter.organization_id = String(organizationId);
    }

    // Projection small, arrays included for FE expectations
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      total_cost: 1,
      createdAt: 1,
      created_at: 1,
      timestamp: 1,
      users: 1,
      projects: 1,
      project: 1,
      agents: 1,
    };

    // Stable sort: createdAt desc, then _id desc to leverage compound indexes
    const sort = { createdAt: -1, _id: -1 };

    // Ensure a connection, but don't block long
    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch { /* ignore */ }
    }
    const db = await getDb();
    const collection = db.collection('llm-costs');

    let data = [];
    let total = 0;

    try {
      const cursor = collection
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(QUERY_TIMEOUT_MS);

      data = await cursor.toArray();

      // Normalize arrays
      data = data.map((d) => {
        const doc = { ...d };
        if (!Array.isArray(doc.users)) doc.users = Array.isArray(doc.users) ? doc.users : (doc.users ? doc.users : []);
        if (!Array.isArray(doc.projects)) {
          if (Array.isArray(doc.project)) doc.projects = doc.project;
          else doc.projects = [];
        }
        if (!Array.isArray(doc.agents)) doc.agents = Array.isArray(doc.agents) ? doc.agents : (doc.agents ? doc.agents : []);
        return doc;
      });

      // Count with bounded time; fall back to estimate
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: Math.min(QUERY_TIMEOUT_MS, 3000) });
      } catch {
        total = data.length + skip;
      }
    } catch (e) {
      const msg = String(e?.message || '');
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(msg));
      if (timedOut) {
        // Graceful 200 to avoid gateway 504 with a clear note
        try { if (organizationId) res.set('X-Applied-Tenant', String(organizationId)); } catch {}
        return res.status(200).json({ data: [], page, limit, total: 0, hasMore: false, note: 'Query timed out' });
      }
      if (msg.toLowerCase().includes('rate limit')) {
        return res.status(429).json({ data: [], page, limit, total: 0, hasMore: false, error: 'Too many requests' });
      }
      return res.status(500).json({ data: [], page, limit, total: 0, hasMore: false, error: 'Failed to fetch llm-costs', detail: msg });
    }

    const hasMore = skip + data.length < total;

    try {
      if (isBypass) res.set('X-Applied-Tenant', 'all-tenants');
      else if (organizationId) res.set('X-Applied-Tenant', String(organizationId));
    } catch {}

    // Standard envelope
    return res.status(200).json({
      data,
      page,
      limit,
      total,
      hasMore,
    });
  } catch (err) {
    return next(err);
  } finally {
    try {
      const dur = Date.now() - t0;
      res.set('X-Query-Duration', String(dur));
      res.set('X-Route-Timing', String(dur));
    } catch {}
  }
}

/**
 * PUBLIC_INTERFACE
 * ensureLlmCostsIndexes
 * One-time index creation helper if indexes are missing.
 * Not called automatically in production; can be triggered from dev utility.
 */
async function ensureLlmCostsIndexes() {
  const db = await getDb();
  const collection = db.collection('llm-costs');
  try {
    await collection.createIndex({ organization_id: 1, createdAt: -1, _id: -1 }, { background: true, name: 'org_createdAt__id' });
  } catch (e) {
    console.warn('[llm-costs] index creation skipped (createdAt):', e?.message || e);
  }
  try {
    await collection.createIndex({ organization_id: 1, _id: -1 }, { background: true, name: 'org___id' });
  } catch (e) {
    console.warn('[llm-costs] index creation skipped (_id):', e?.message || e);
  }
  try {
    await collection.createIndex({ organization_id: 1, created_at: -1, _id: -1 }, { background: true, name: 'org_created_at__id' });
  } catch (e) {
    console.warn('[llm-costs] index creation skipped (created_at):', e?.message || e);
  }
}

module.exports = { listLLMCostsStd, ensureLlmCostsIndexes };
