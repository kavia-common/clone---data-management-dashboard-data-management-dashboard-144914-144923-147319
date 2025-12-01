'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Optimized listing for 'llm-costs' collection with profiling/timeout guards:
 *  - Early index-backed sort/skip/limit by { organization_id, _id: -1 } or createdAt desc
 *  - Minimal projection to avoid large payloads before pagination
 *  - Batched user enrichment via single users.find({ _id: { $in } }) without ObjectId casting
 *  - Env-guarded profiling (LLM_COSTS_PROFILE=true) with timing and optional explain('executionStats')
 *  - Query timeout via env LLM_COSTS_QUERY_TIMEOUT_MS (default 8000) with graceful 504 on timeouts
 *  - Diagnostic headers: X-DB-Connected, X-Org-Filter, X-Query-Duration, X-Users-Enriched (+ optional profiling logs)
 *
 * Query params: organization_id|tenant_id, page, limit
 */
async function listLLMCosts(req, res, next) {
  const t0 = Date.now();

  const PROFILE = String(process.env.LLM_COSTS_PROFILE || '').toLowerCase() === 'true';
  const QUERY_TIMEOUT_MS = Number.parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '8000', 10);
  const safeTimeout = Number.isFinite(QUERY_TIMEOUT_MS) && QUERY_TIMEOUT_MS > 0 ? QUERY_TIMEOUT_MS : 8000;

  const logProfile = (...args) => {
    if (PROFILE) {
      // eslint-disable-next-line no-console
      console.log('[llm-costs][profile]', ...args);
    }
  };

  try {
    // Fail fast if DB is not configured
    if (!process.env.MONGODB_URI) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      return res.status(503).json({
        success: false,
        error: 'Database not configured',
        detail: 'MONGODB_URI is missing',
      });
    }

    // Quick readiness probe (~1s)
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

    // Attempt opportunistic connect if not connected (non-blocking)
    if (!isDbConnected()) {
      try { await mongoose.connect(process.env.MONGODB_URI); } catch (_) {}
    }

    const db = await getDb();
    const collection = db.collection('llm-costs');

    // Resolve organization filter & tenant scoping
    const superAdminBypass = !!(req.tenantScopeDisabled || req.allTenants);
    const scopedTenant = !superAdminBypass ? (req.tenantId || req.organizationId) : undefined;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const resolvedTenant = scopedTenant || headerTenant || queryTenant || undefined;

    // Build filter on indexed field EXACTLY: { organization_id }
    const filter = {};
    if (resolvedTenant) {
      filter.organization_id = String(resolvedTenant);
    }

    // Sorting: prefer _id desc (has native index and pairs well with filter); fallback createdAt desc
    const sort = { _id: -1 };

    // Pagination & limit caps
    let limit = 20;
    if (req.query.limit) {
      const l = parseInt(req.query.limit, 10);
      if (Number.isFinite(l) && l > 0) limit = l;
    }
    // hard cap to avoid overly heavy pages
    limit = Math.min(limit, 50);

    const page = req.query.page ? parseInt(req.query.page, 10) : undefined;
    const hasPagination = Number.isInteger(page) && page >= 1;
    const safePage = hasPagination ? page : 1;
    const skip = hasPagination ? (safePage - 1) * limit : 0;

    // Minimal projection BEFORE pagination to reduce IO; include arrays but avoid extra fields
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      users: 1,
      projects: 1,
      project: 1,
      agents: 1,
      createdAt: 1,
    };

    // Optional profiling: explain query plan with executionStats (guarded)
    if (PROFILE) {
      try {
        const explain = await collection
          .find(filter, { projection })
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .maxTimeMS(Math.min(safeTimeout, 2000)) // keep explain bounded
          .explain('executionStats');

        // Only log compact summary to avoid log bloat
        const nReturned = explain?.executionStats?.nReturned;
        const totalDocsExamined = explain?.executionStats?.totalDocsExamined;
        const totalKeysExamined = explain?.executionStats?.totalKeysExamined;
        const executionTimeMillis = explain?.executionStats?.executionTimeMillis;
        logProfile('explain summary', {
          nReturned,
          totalDocsExamined,
          totalKeysExamined,
          executionTimeMillis,
          filter,
          sort,
          skip,
          limit,
        });
      } catch (ex) {
        logProfile('explain failed', ex?.message || ex);
      }
    }

    let docs = [];
    try {
      const tFind0 = Date.now();
      const cursor = collection
        .find(filter, { projection })
        .sort(sort)            // early sort
        .skip(skip)            // early skip
        .limit(limit)          // early limit
        .maxTimeMS(safeTimeout);

      docs = await cursor.toArray();
      logProfile('find page ms=', Date.now() - tFind0);

      // Ensure arrays present even if absent in source document for UI expectations
      docs = docs.map((d) => {
        if (!Array.isArray(d.users)) d.users = Array.isArray(d.users) ? d.users : (d.users ? d.users : []);
        // prefer 'projects' field; if missing but 'project' exists and is array, copy over
        if (!Array.isArray(d.projects)) {
          if (Array.isArray(d.project)) d.projects = d.project;
          else d.projects = [];
        }
        if (!Array.isArray(d.agents)) d.agents = Array.isArray(d.agents) ? d.agents : (d.agents ? d.agents : []);
        return d;
      });
    } catch (e) {
      const timedOut =
        e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : '');
      res.set('X-Query-Duration', String(Date.now() - t0));
      return res
        .status(timedOut ? 504 : 500)
        .json({
          success: false,
          error: timedOut ? 'Query timed out' : 'Query failed',
          hint: timedOut ? 'Consider tightening tenant filter or adding index { organization_id:1, _id:-1 }' : undefined,
        });
    }

    // Batched user enrichment using string UUIDs (no ObjectId casting)
    try {
      const enrichStart = Date.now();
      const allIdsSet = new Set();
      for (const d of docs) {
        if (Array.isArray(d.users)) {
          for (const u of d.users) {
            const raw = u?.user_id ?? null;
            if (raw !== null && raw !== undefined) {
              const s = String(raw).trim();
              if (s) allIdsSet.add(s);
            }
          }
        }
      }

      const firstFew = Array.from(allIdsSet).slice(0, 5);

      if (allIdsSet.size > 0) {
        const usersColl = db.collection('users');

        const ids = Array.from(allIdsSet);
        const userQuery = { _id: { $in: ids } }; // Expect _id to be string UUIDs in users collection
        const userProjection = {
          _id: 1,
          email: 1,
          username: 1,
          name: 1,
          displayName: 1,
          display_name: 1,
          full_name: 1,
          organization_id: 1,
          tenant_id: 1,
          status: 1,
          profile: 1,
          created_at: 1,
          updated_at: 1,
        };

        const foundUsers = await usersColl
          .find(userQuery, { projection: userProjection })
          .maxTimeMS(Math.min(safeTimeout, 4000))
          .toArray();

        const userMap = {};
        for (const u of foundUsers) {
          if (u && u._id != null) {
            userMap[String(u._id)] = u;
          }
        }

        for (const d of docs) {
          if (Array.isArray(d.users)) {
            d.users = d.users.map((entry) => {
              const key = entry && entry.user_id != null ? String(entry.user_id).trim() : '';
              const enriched = { ...entry };
              enriched.user = key ? (userMap[key] || null) : null;
              return enriched;
            });
          }
        }

        try {
          res.set('X-Users-Enriched', `${Object.keys(userMap).length}/${allIdsSet.size}`);
          res.set('X-Users-Match-Field', '_id');
          if (firstFew.length > 0) res.set('X-Users-Sample-Ids', firstFew.join(',').slice(0, 128));
        } catch {}
      } else {
        try { res.set('X-Users-Enriched', '0/0'); } catch {}
      }

      logProfile('user enrichment ms=', Date.now() - enrichStart);
    } catch (enrichErr) {
      try {
        console.warn('[llm-costs] user enrichment failed:', enrichErr?.message || enrichErr);
        res.set('X-Users-Enriched', 'error');
      } catch {}
    }

    // Diagnostics and headers
    res.set('X-DB-Connected', String(isDbConnected()));
    res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
    res.set('X-Query-Duration', String(Date.now() - t0));

    // Count for meta when paginated: use same filter, small timeout; degrade gracefully on timeout
    if (hasPagination) {
      let total = 0;
      try {
        const tCount0 = Date.now();
        total = await collection.countDocuments(filter, { maxTimeMS: Math.min(safeTimeout, 2000) });
        logProfile('count ms=', Date.now() - tCount0);
      } catch (_) {
        total = docs.length + skip;
      }
      return res.status(200).json({
        success: true,
        data: docs,
        meta: { page: safePage, limit, total },
      });
    }

    // Raw array when no pagination requested
    return res.status(200).json(docs);
  } catch (err) {
    try { res.set('X-Query-Duration', String(Date.now() - t0)); } catch {}
    return next(err);
  }
}

module.exports = { listLLMCosts };
