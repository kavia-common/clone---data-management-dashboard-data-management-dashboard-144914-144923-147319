'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
// PUBLIC_INTERFACE
 * listLLMCostsStd
 * GET /api/llm-costs
 *
 * Hardened list endpoint for LLM costs:
 * - Confirms DB connectivity quickly; returns graceful 503 JSON when DB not configured.
 * - Enforces tenant scoping via middleware-provided req.tenantId unless Super Admin all-tenant mode is active.
 * - Applies lean projection, stable sort, and maxTimeMS to avoid gateway timeouts (502/504).
 * - Ensures compound indexes exist with an optional background creation step.
 * - Responds with standard envelope: { data, page, limit, total, hasMore }.
 */
async function listLLMCostsStd(req, res, next) {
  const t0 = Date.now();

  const MAX_LIMIT = 100;
  const DEFAULT_LIMIT = 20;
  const DEFAULT_PAGE = 1;
  const timeoutCfg = Number.parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '8000', 10);
  const QUERY_TIMEOUT_MS = Number.isFinite(timeoutCfg) && timeoutCfg > 0 ? timeoutCfg : 8000;

  try {
    // Request-id header for correlation
    try {
      if (req.traceId) res.set('X-Request-Id', req.traceId);
    } catch {}

    // 1) DB config present?
    if (!process.env.MONGODB_URI) {
      return res.status(503).json({
        success: false,
        error: 'Database not configured',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    }

    // 2) Quick readiness within 1s to avoid gateway timeout
    const readiness = await isDBReadyFast(Math.min(1000, QUERY_TIMEOUT_MS));
    // Resolve tenant context for diagnostics regardless of readiness
    const ctxTenant = req.tenantId || req.organizationId || req.auth?.tenantId;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const organizationId = ctxTenant || headerTenant || queryTenant;

    if (!readiness.ok) {
      try { res.set('X-Applied-Tenant', organizationId ? String(organizationId) : ''); } catch {}
      // 6) If DB is not reachable, return graceful 503 (explicit per requirements)
      return res.status(503).json({
        success: false,
        error: 'Database not ready',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    }

    // 3) Middleware chain: requireTenant should have set req.tenantId unless super admin bypass
    const isBypass = !!(req.tenantScopeDisabled || req.allTenants);
    if (!organizationId && !isBypass) {
      try { res.set('X-Applied-Tenant', ''); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Missing organization_id. Provide via auth tenant, x-organization-id header, or ?organization_id',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    }

    // 4) Pagination
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

    // Filter on organization_id unless bypassed
    const filter = {};
    if (organizationId && !isBypass) {
      filter.organization_id = String(organizationId);
    }

    // 2) Ensure compound indexes exist (background creation; non-blocking)
    try {
      const dbForIndex = await getDb();
      const colForIndex = dbForIndex.collection('llm-costs');
      // Primary index as requested
      await colForIndex.createIndex({ organization_id: 1, createdAt: -1, _id: -1 }, { background: true, name: 'org_createdAt__id' });
      // Fallback minimal index if createdAt missing in datasets
      await colForIndex.createIndex({ organization_id: 1, _id: -1 }, { background: true, name: 'org___id' });
    } catch (e) {
      // non-fatal
      try { console.warn('[llm-costs] index ensure warning:', e?.message || e); } catch {}
    }

    // 4) Performance-friendly projection and sort
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

    // Prefer createdAt desc then _id desc. If createdAt absent for some docs, _id desc still stabilizes order.
    const sort = { createdAt: -1, _id: -1 };

    // Make sure we are connected (short, non-blocking options are applied in connect)
    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch { /* ignore connect race */ }
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

      // Total with bounded time
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: Math.min(QUERY_TIMEOUT_MS, 3000) });
      } catch {
        total = data.length + skip;
      }
    } catch (e) {
      const msg = String(e?.message || '');
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(msg));
      if (timedOut) {
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

    // 5) Standard envelope with 200 OK
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
    // 5) timing headers
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
 * Utility to ensure required indexes exist.
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
