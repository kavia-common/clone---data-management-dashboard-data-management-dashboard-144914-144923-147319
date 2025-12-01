'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Deterministic and bounded behavior for listing documents from 'llm-costs':
 *  - Early and index-friendly sort+skip+limit on { organization_id, _id } to avoid blocking sorts
 *  - Optional profiling: explain('executionStats') behind env LLM_COSTS_PROFILE=true (only on page=1)
 *  - Bound query time via maxTimeMS from env LLM_COSTS_QUERY_TIMEOUT_MS (default 8000)
 *  - Project only required fields for listing and enrichment
 *  - Batched enrichment for users[] via single find({_id: {$in: [...]}}) with string UUIDs (no ObjectId casting)
 *  - Graceful 504 only when maxTimeMS exceeded; otherwise return best-effort
 *  - Adds diagnostics headers: X-DB-Connected, X-Org-Filter, X-Query-Duration
 */
async function listLLMCosts(req, res, next) {
  const t0 = Date.now();
  const profileEnabled = String(process.env.LLM_COSTS_PROFILE || '').toLowerCase() === 'true';
  const serverTimeoutMs = Number.isFinite(parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '', 10))
    ? parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS, 10)
    : 8000;

  // Soft guard timer to avoid long tail during enrichment/count
  let timedOutServerGuard = false;
  const serverTimeoutHandle = setTimeout(() => {
    timedOutServerGuard = true;
  }, Math.max(1000, serverTimeoutMs));

  try {
    // Fail fast when DB not configured
    if (!process.env.MONGODB_URI) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      return res.status(503).json({
        success: false,
        error: 'Database not configured',
        detail: 'MONGODB_URI is missing',
      });
    }

    // Quick readiness check
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
      try { await mongoose.connect(process.env.MONGODB_URI); } catch (_) {}
    }

    const db = await getDb();
    const collection = db.collection('llm-costs');

    // Resolve tenant scope (middleware > header > query)
    const superAdminBypass = !!(req.tenantScopeDisabled || req.allTenants);
    const scopedTenant = !superAdminBypass ? (req.tenantId || req.organizationId) : undefined;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const resolvedTenant = scopedTenant || headerTenant || queryTenant || undefined;

    // Filter (only organization_id for index path)
    const filter = {};
    if (resolvedTenant) filter.organization_id = String(resolvedTenant);

    // Sort & pagination – rely on {organization_id:1,_id:-1} index (or {_id:-1} when no tenant)
    const sort = { _id: -1 };
    let limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const pageRaw = parseInt(req.query.page, 10);
    const hasPagination = Number.isInteger(pageRaw) && pageRaw >= 1;
    const page = hasPagination ? pageRaw : 1;
    const skip = (page - 1) * limit;

    // Projection – only what UI needs and enrichment depends on
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      users: 1,      // required to preserve users[].user_cost and users[].projects
      projects: 1,   // presence for UI, filled from project if missing
      project: 1,    // legacy alias
      agents: 1,
      createdAt: 1,
      created_at: 1,
      timestamp: 1,
    };

    const mongoTimeout = Number.isFinite(parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS || '', 10))
      ? Math.max(1000, Math.min(parseInt(process.env.LLM_COSTS_QUERY_TIMEOUT_MS, 10), 15000))
      : 8000;

    // Build base cursor with early sort/skip/limit and ensure index usage when tenant is present
    let cursor = collection.find(filter, { projection }).sort(sort).skip(skip).limit(limit).maxTimeMS(mongoTimeout);

    // One-off query plan sampling when profiling and first page
    if (profileEnabled && page === 1) {
      try {
        const plan = await collection
          .find(filter, { projection })
          .sort(sort)
          .skip(0)
          .limit(Math.min(10, limit || 10))
          .maxTimeMS(mongoTimeout)
          .explain('executionStats');

        const nReturned = plan?.executionStats?.nReturned ?? null;
        const totalDocsExamined = plan?.executionStats?.totalDocsExamined ?? null;
        const totalKeysExamined = plan?.executionStats?.totalKeysExamined ?? null;
        const winning = plan?.queryPlanner?.winningPlan;
        const stageSummary = winning?.stage || winning?.inputStage?.stage || 'n/a';
        console.info(
          `[llm-costs] explain p1 limit=${limit} filterKeys=${Object.keys(filter)} returned=${nReturned} keys=${totalKeysExamined} docs=${totalDocsExamined} stage=${stageSummary}`
        );
      } catch (ex) {
        console.warn('[llm-costs] explain failed:', ex?.message || ex);
      }
    }

    // Fetch documents
    let docs;
    try {
      const qStart = Date.now();
      docs = await cursor.toArray();
      if (profileEnabled) {
        console.info(`[llm-costs] find page=${page} limit=${limit} took=${Date.now() - qStart}ms filter=${JSON.stringify(filter)}`);
      }
    } catch (e) {
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
      res.set('X-Query-Duration', String(Date.now() - t0));
      return res.status(timedOut ? 504 : 500).json({
        success: false,
        error: timedOut ? 'Query timed out' : 'Query failed',
      });
    }

    // Normalize arrays and legacy aliases
    docs = (docs || []).map((d) => {
      if (!Array.isArray(d.users)) d.users = [];
      if (!Array.isArray(d.projects)) d.projects = Array.isArray(d.project) ? d.project : [];
      if (!Array.isArray(d.agents)) d.agents = [];
      return d;
    });

    // If soft guard already elapsed, return early without enrichment/count
    if (timedOutServerGuard) {
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
      res.set('X-Query-Duration', String(Date.now() - t0));
      clearTimeout(serverTimeoutHandle);
      return res.status(200).json({
        success: true,
        data: docs,
        meta: { page, limit, total: docs.length + skip }, // approximate when guard hit
      });
    }

    // Batched enrichment of users by string UUIDs
    try {
      const idsSet = new Set();
      for (const d of docs) {
        for (const u of d.users || []) {
          const raw = u?.user_id;
          if (raw !== null && raw !== undefined) {
            const s = String(raw).trim();
            if (s) idsSet.add(s);
          }
        }
      }

      if (idsSet.size > 0) {
        const usersColl = db.collection('users');
        const ids = Array.from(idsSet);
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

        const remaining = Math.max(1000, serverTimeoutMs - (Date.now() - t0));
        const foundUsers = await usersColl
          .find({ _id: { $in: ids } }, { projection: userProjection })
          .maxTimeMS(Math.min(3500, remaining))
          .toArray();

        const map = {};
        for (const u of foundUsers) map[String(u._id)] = u;

        for (const d of docs) {
          d.users = (d.users || []).map((entry) => {
            const key = entry && entry.user_id != null ? String(entry.user_id).trim() : '';
            return { ...entry, user: key ? map[key] || null : null };
          });
        }

        // Diagnostics to validate enrichment
        try {
          res.set('X-Users-Enriched', `${Object.keys(map).length}/${ids.length}`);
          res.set('X-Users-Match-Field', '_id');
        } catch (_) {}
      } else {
        try { res.set('X-Users-Enriched', '0/0'); } catch (_) {}
      }
    } catch (enrichErr) {
      console.warn('[llm-costs] user enrichment failed:', enrichErr?.message || enrichErr);
      try { res.set('X-Users-Enriched', 'error'); } catch (_) {}
    }

    // Diagnostics
    res.set('X-DB-Connected', String(isDbConnected()));
    res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
    res.set('X-Query-Duration', String(Date.now() - t0));

    // Envelope when pagination provided
    if (hasPagination) {
      let total = 0;
      try {
        const remaining = Math.max(750, serverTimeoutMs - (Date.now() - t0));
        total = await collection.countDocuments(filter, { maxTimeMS: Math.min(2000, remaining) });
      } catch {
        total = docs.length + skip;
      }

      clearTimeout(serverTimeoutHandle);
      return res.status(200).json({
        success: true,
        data: docs,
        meta: { page, limit, total },
      });
    }

    // Raw array otherwise
    clearTimeout(serverTimeoutHandle);
    return res.status(200).json(docs);
  } catch (err) {
    clearTimeout(serverTimeoutHandle);
    try { res.set('X-Query-Duration', String(Date.now() - t0)); } catch {}
    return next(err);
  }
}

module.exports = { listLLMCosts };
