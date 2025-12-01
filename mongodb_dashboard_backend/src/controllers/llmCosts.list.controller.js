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
  const QUERY_TIMEOUT_MS_INPUT = Number.parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '8000', 10);
  const QUERY_TIMEOUT_MS = Number.isFinite(QUERY_TIMEOUT_MS_INPUT) && QUERY_TIMEOUT_MS_INPUT > 0 ? QUERY_TIMEOUT_MS_INPUT : 8000;

  try {
    // Attach correlation and tenant headers at start
    try {
      if (req.traceId) res.set('X-Request-Id', req.traceId);
    } catch {}
    // Ensure DB configured and briefly ready to avoid hanging
    if (!process.env.MONGODB_URI) {
      return res.status(503).json({ success: false, message: 'Database not configured' });
    }

    const readiness = await isDBReadyFast(Math.min(1000, QUERY_TIMEOUT_MS));
    if (!readiness.ok) {
      try { res.set('X-Applied-Tenant', organizationId ? String(organizationId) : ''); } catch {}
      // Graceful degrade with 200 + empty envelope if DB read fails quickly
      return res.status(200).json({ data: [], page: DEFAULT_PAGE, limit: DEFAULT_LIMIT, total: 0, hasMore: false, note: 'DB not ready' });
    }

    // Resolve tenant (organization) from context first
    const ctxTenant = req.tenantId || req.organizationId || req.auth?.tenantId;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const organizationId = ctxTenant || headerTenant || queryTenant;

    // Defensive: missing organization_id is a 400 (when not in super-admin all-tenants mode)
    if (!organizationId && !(req.tenantScopeDisabled || req.allTenants)) {
      try { res.set('X-Applied-Tenant', ''); } catch {}
      return res.status(400).json({ success: false, message: 'Missing organization_id. Provide via auth tenant, x-organization-id header, or ?organization_id' });
    }

    // Enforce sane pagination defaults and caps
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

    // Index-friendly filter
    const filter = {};
    if (organizationId) {
      filter.organization_id = String(organizationId);
    }

    // Projection to keep payload small
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

    // Sort: prefer createdAt desc then _id desc; fall back to _id desc when needed
    // We'll attempt a compound sort; Mongo will use _id when createdAt missing
    const sort = { createdAt: -1, _id: -1 };

    // Ensure connection (non-blocking failure tolerated by readiness above)
    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch { /* no-op */ }
    }
    const db = await getDb();
    const collection = db.collection('llm-costs'); // Model/collection name already normalized to 'llm-costs'

    // Query page
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

      // Defensive field normalization for FE expectations
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

      // Count with small timeout, degrade gracefully
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: Math.min(QUERY_TIMEOUT_MS, 3000) });
      } catch {
        // fallback estimate
        total = data.length + skip;
      }
    } catch (e) {
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      if (timedOut) {
        // Graceful 200 with empty data to avoid 504 bubbles for list UX
        return res.status(200).json({ data: [], page, limit, total: 0, hasMore: false, note: 'Query timed out' });
      }
      // If server rate limiting occurred upstream
      if (String(e?.message || '').toLowerCase().includes('rate limit')) {
        return res.status(429).json({ success: false, message: 'Too many requests. Please slow down and try again.' });
      }
      return res.status(500).json({ success: false, message: 'Failed to fetch llm-costs', detail: e?.message || 'Unknown error' });
    }

    const hasMore = skip + data.length < total;
    try {
      if (organizationId) res.set('X-Applied-Tenant', String(organizationId));
    } catch {}

    // Standard list envelope
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
    // eslint-disable-next-line no-console
    console.warn('[llm-costs] index creation skipped:', e?.message || e);
  }
}

module.exports = { listLLMCostsStd, ensureLlmCostsIndexes };
