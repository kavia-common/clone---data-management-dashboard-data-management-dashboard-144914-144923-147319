'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
// PUBLIC_INTERFACE
 * listLLMCostsStd
 * GET /api/llm-costs
 *
 * Hardened list endpoint for LLM costs with resiliency:
 * - Validates env (MONGODB_URI and MONGODB_DB) and returns 503 with clear message when missing.
 * - Enforces tenant scoping; supports fallback $or across variant tenant fields.
 * - Autodetects collection between 'llm-costs' and 'llm_costs', prefers one with data, and caches choice for the process lifetime.
 * - Ensures indexes for {organization_id:1, createdAt:-1, _id:-1} and fallback {organization_id:1, _id:-1}.
 * - Tuned timeouts: primary list maxTimeMS≈3000ms; countDocuments with shorter timeout; degrade with total=null when count times out.
 * - Returns envelope: { data, page, limit, total, hasMore } and headers X-Request-Id, X-Route-Timing, X-Applied-Tenant.
 */
let CACHED_LLM_COSTS_COLLECTION = null; // process-level cache of chosen collection name

async function resolveLlmCostsCollection(db) {
  if (CACHED_LLM_COSTS_COLLECTION) return db.collection(CACHED_LLM_COSTS_COLLECTION);

  // Probe candidates by existence and data presence (cheap sample)
  const candidates = ['llm-costs', 'llm_costs'];
  let chosen = candidates[0];

  try {
    const names = await db.listCollections({}, { nameOnly: true }).toArray();
    const nameSet = new Set(names.map((n) => n.name));
    const existing = candidates.filter((n) => nameSet.has(n));
    if (existing.length === 1) {
      chosen = existing[0];
    } else if (existing.length > 1) {
      // Prefer the one that actually has data
      const counts = [];
      for (const n of existing) {
        try {
          const sample = await db.collection(n).find({}, { projection: { _id: 1 } }).limit(1).maxTimeMS(1000).toArray();
          counts.push([n, Array.isArray(sample) && sample.length > 0 ? 1 : 0]);
        } catch {
          counts.push([n, 0]);
        }
      }
      // choose the one with data; fallback to first candidate
      const withData = counts.find((c) => c[1] > 0);
      chosen = withData ? withData[0] : existing[0];
    } else {
      // none exist; fallback to default hyphenated
      chosen = candidates[0];
    }
  } catch {
    chosen = candidates[0];
  }

  CACHED_LLM_COSTS_COLLECTION = chosen;
  return db.collection(chosen);
}

async function ensureIndexes(collection) {
  try {
    await collection.createIndex({ organization_id: 1, createdAt: -1, _id: -1 }, { background: true, name: 'org_createdAt__id' });
  } catch (e) {
    try { console.warn('[llm-costs] ensureIndexes createdAt warn:', e?.message || e); } catch {}
  }
  try {
    await collection.createIndex({ organization_id: 1, _id: -1 }, { background: true, name: 'org___id' });
  } catch (e) {
    try { console.warn('[llm-costs] ensureIndexes _id warn:', e?.message || e); } catch {}
  }
}

async function listLLMCostsStd(req, res, next) {
  const t0 = Date.now();

  const MAX_LIMIT = 100;
  const DEFAULT_LIMIT = 20;
  const DEFAULT_PAGE = 1;

  // Tuned timeouts
  const listTimeout = Math.min(3000, Number.parseInt(process.env.LLM_COSTS_LIST_TIMEOUT_MS || '3000', 10) || 3000);
  const countTimeout = Math.min(2000, Number.parseInt(process.env.LLM_COSTS_COUNT_TIMEOUT_MS || '1200', 10) || 1200);

  const ctxTenant = req.tenantId || req.organizationId || req.auth?.tenantId;
  const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'] || req.headers['x-tenant-id'] || req.headers['x-tenant'];
  const queryTenant = req.query.organization_id || req.query.tenant_id;
  const organizationId = ctxTenant || headerTenant || queryTenant;

  try {
    // Attach request-id
    try {
      const rid =
        (typeof req.traceId === 'string' && req.traceId) ||
        (req.headers['x-request-id'] ? String(req.headers['x-request-id']) : null) ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      if (rid) res.set('X-Request-Id', rid);
    } catch {}

    // Env validation
    if (!process.env.MONGODB_URI || String(process.env.MONGODB_URI).trim() === '') {
      try { console.error('[llm-costs] MONGODB_URI not set'); } catch {}
      return res.status(503).json({
        success: false,
        error: 'Database not configured (MONGODB_URI missing)',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    }
    if (!process.env.MONGODB_DB || String(process.env.MONGODB_DB).trim() === '') {
      // Accept relying on DB from URI but expose header note for ops
      try { res.set('X-DB-Name-Source', 'uri'); } catch {}
    } else {
      try { res.set('X-DB-Name', String(process.env.MONGODB_DB)); } catch {}
    }

    // Readiness short-circuit to avoid 5xx/504
    const readiness = await isDBReadyFast(1000);
    if (!readiness.ok) {
      try { res.set('X-DB-Ready', 'false'); } catch {}
      return res.status(503).json({
        success: false,
        error: 'Database not ready',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    } else {
      try { res.set('X-DB-Ready', 'true'); } catch {}
    }

    const isBypass = !!(req.tenantScopeDisabled || req.allTenants);
    if (!organizationId && !isBypass) {
      try { res.set('X-Applied-Tenant', ''); } catch {}
      return res.status(400).json({
        success: false,
        error: 'Missing organization_id. Use header x-organization-id or ?organization_id',
        data: [],
        page: DEFAULT_PAGE,
        limit: DEFAULT_LIMIT,
        total: 0,
        hasMore: false,
      });
    }

    // Pagination
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

    // Tenant filter with variants
    const filter = {};
    let usingFallbackOr = false;
    if (organizationId && !isBypass) {
      const org = String(organizationId);
      // Prefer organization_id when available by using $or but with organization_id first which aligns with index
      filter.$or = [
        { organization_id: org },
        { tenant_id: org },
        { organizationId: org },
        { tenantId: org },
        { orgId: org },
        { 'tenant.tenant_id': org },
      ];
      usingFallbackOr = true;
    }

    // DB connect and collection resolve
    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch {}
    }
    const db = await getDb();
    const collection = await resolveLlmCostsCollection(db);

    // Ensure indexes
    await ensureIndexes(collection);

    // Hint header if we likely use non-indexed fields
    if (usingFallbackOr) {
      try { res.set('X-Tenant-Filter', 'or-variants'); } catch {}
    }

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
    const sort = { createdAt: -1, _id: -1 };

    // Main list with modest timeout
    let data = [];
    try {
      data = await collection
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(listTimeout)
        .toArray();
    } catch (e) {
      const msg = String(e?.message || '');
      // Retry with _id desc and smaller page if timed out
      if (/exceeded time limit|timed out|network timeout/i.test(msg) || e?.code === 50) {
        try {
          data = await collection
            .find(filter, { projection })
            .sort({ _id: -1 })
            .skip(0)
            .limit(Math.min(limit, 10))
            .maxTimeMS(Math.max(1500, listTimeout))
            .toArray();
        } catch {
          data = [];
        }
      } else {
        // other errors
        return res.status(500).json({ data: [], page, limit, total: 0, hasMore: false, error: 'Failed to fetch llm-costs', detail: msg });
      }
    }

    // Normalize array fields
    data = (data || []).map((d) => {
      const doc = { ...d };
      if (!Array.isArray(doc.users)) doc.users = Array.isArray(doc.users) ? doc.users : (doc.users ? doc.users : []);
      if (!Array.isArray(doc.projects)) {
        if (Array.isArray(doc.project)) doc.projects = doc.project;
        else doc.projects = [];
      }
      if (!Array.isArray(doc.agents)) doc.agents = Array.isArray(doc.agents) ? doc.agents : (doc.agents ? doc.agents : []);
      return doc;
    });

    // Count with shorter timeout; degrade gracefully
    let total = null;
    let hasMore = false;
    try {
      const cnt = await collection.countDocuments(filter, { maxTimeMS: countTimeout });
      total = cnt;
      hasMore = skip + data.length < cnt;
    } catch {
      total = null;
      hasMore = data.length === limit; // infer
      try { res.set('X-Count-Note', 'count-timeout'); } catch {}
    }

    try {
      if (isBypass) res.set('X-Applied-Tenant', 'all-tenants');
      else if (organizationId) res.set('X-Applied-Tenant', String(organizationId));
    } catch {}

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
 * Utility to ensure required indexes exist.
 */
async function ensureLlmCostsIndexes() {
  const db = await getDb();
  const collection = await resolveLlmCostsCollection(db);
  await ensureIndexes(collection);
}

module.exports = { listLLMCostsStd, ensureLlmCostsIndexes };
