'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Deterministic and bounded behavior for listing documents from 'llm-costs':
 *  - Fast readiness short-circuit: if DB isn't ready or MONGODB_URI missing, return 503 JSON (no gateway timeout)
 *  - Direct find() on 'llm-costs' with exact organization_id filter when provided; otherwise return all
 *  - Bounded: maxTimeMS(5000), limit capped at 50, stable sort by _id desc
 *  - Projection includes: _id, organization_id, organization_name, organization_cost, users, projects, agents
 *  - Adds diagnostic headers: X-DB-Connected, X-Org-Filter, X-Query-Duration
 *  - Pagination: ?page, ?limit; returns { success, data, meta } when paginating; raw array otherwise
 *  - Enhancement: For each document, embed full user document for each users[i] based on users[i].user_id into users[i].user (null when not found).
 */
async function listLLMCosts(req, res, next) {
  const t0 = Date.now();

  // Hard ceiling for this handler to avoid hanging connections (graceful 504)
  const HARD_TIMEOUT_MS = 10000; // 10s ceiling for the entire request lifecycle
  let hardTimeoutFired = false;
  const hardTimer = setTimeout(() => {
    hardTimeoutFired = true;
    try {
      if (!res.headersSent) {
        res.set('X-Query-Duration', String(Date.now() - t0));
        res.status(504).json({ success: false, error: 'Request timed out' });
      }
    } catch {}
  }, HARD_TIMEOUT_MS);

  try {
    // Fail fast if DB is not configured
    if (!process.env.MONGODB_URI) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      clearTimeout(hardTimer);
      return res.status(503).json({
        success: false,
        error: 'Database not configured',
        detail: 'MONGODB_URI is missing',
      });
    }

    // Quick readiness probe (~1s)
    const readiness = await isDBReadyFast(800);
    if (!readiness.ok) {
      res.set('X-DB-Connected', 'false');
      res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      clearTimeout(hardTimer);
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

    // Resolve organization filter (scoped unless super admin bypass)
    const superAdminBypass = !!(req.tenantScopeDisabled || req.allTenants);
    const scopedTenant = !superAdminBypass ? (req.tenantId || req.organizationId) : undefined;
    const headerTenant = req.headers['x-organization-id'] || req.headers['organization_id'];
    const queryTenant = req.query.organization_id || req.query.tenant_id;
    const resolvedTenant = scopedTenant || headerTenant || queryTenant || undefined;

    // Build filter
    const filter = {};
    if (resolvedTenant) {
      filter.organization_id = String(resolvedTenant);
    }

    // Sorting and pagination
    const sort = { _id: -1 };

    let limit = 20;
    if (req.query.limit) {
      const l = parseInt(req.query.limit, 10);
      if (Number.isFinite(l) && l > 0) limit = l;
    }
    limit = Math.min(limit, 50);

    const page = req.query.page ? parseInt(req.query.page, 10) : undefined;
    const hasPagination = Number.isInteger(page) && page >= 1;
    const safePage = hasPagination ? page : 1;
    const skip = hasPagination ? (safePage - 1) * limit : 0;

    // Projection to include required fields and arrays
    const projection = {
      _id: 1,
      organization_id: 1,
      organization_name: 1,
      organization_cost: 1,
      users: 1,
      project: 1,
      projects: 1,
      agents: 1,
    };

    let docs = [];
    try {
      const cursor = collection
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(4000); // slightly reduced to avoid long waits

      docs = await cursor.toArray();

      // Ensure arrays present even if absent in source document for UI expectations
      docs = docs.map((d) => {
        try {
          if (!Array.isArray(d.users)) d.users = Array.isArray(d.users) ? d.users : (d.users ? d.users : []);
          if (!Array.isArray(d.projects)) {
            if (Array.isArray(d.project)) d.projects = d.project;
            else d.projects = [];
          }
          if (!Array.isArray(d.agents)) d.agents = Array.isArray(d.agents) ? d.agents : (d.agents ? d.agents : []);
          return d;
        } catch {
          return d || {};
        }
      });
    } catch (e) {
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : '');
      res.set('X-Query-Duration', String(Date.now() - t0));
      clearTimeout(hardTimer);
      return res.status(timedOut ? 504 : 500).json({ success: false, error: timedOut ? 'Query timed out' : 'Query failed' });
    }

    // Batched enrichment: fetch full user docs for all users[].user_id across returned docs
    try {
      // Collect distinct user ids as strings
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
        const userQuery = { _id: { $in: ids } };
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

        let foundUsers = [];
        try {
          // Soft deadline for enrichment to avoid impacting main response
          const ENRICH_MAX_MS = 3000;
          const tEnrich0 = Date.now();
          foundUsers = await usersColl.find(userQuery, { projection: userProjection }).maxTimeMS(ENRICH_MAX_MS).toArray();
          const enrichMs = Date.now() - tEnrich0;
          try { res.set('X-Users-Enrich-MS', String(enrichMs)); } catch {}
        } catch (e) {
          // Skip enrichment on timeout or failure
          try { res.set('X-Users-Enriched', 'skipped'); } catch {}
          foundUsers = [];
        }

        const userMap = {};
        for (const u of foundUsers) {
          if (u && u._id != null) {
            userMap[String(u._id)] = u;
          }
        }

        for (const d of docs) {
          if (Array.isArray(d.users)) {
            d.users = d.users.map((entry) => {
              try {
                const key = entry && entry.user_id != null ? String(entry.user_id).trim() : '';
                // Preserve all original user subfields including user_cost
                const enriched = { ...entry };
                enriched.user = key ? (userMap[key] || null) : null;
                return enriched;
              } catch {
                return entry;
              }
            });
          }
        }

        try {
          const enrichedCount = Object.keys(userMap).length;
          res.set('X-Users-Enriched', `${enrichedCount}/${allIdsSet.size}`);
          res.set('X-Users-Match-Field', '_id');
          if (firstFew.length > 0) {
            res.set('X-Users-Sample-Ids', firstFew.join(',').slice(0, 128));
          }
        } catch {}
      } else {
        try { res.set('X-Users-Enriched', '0/0'); } catch {}
      }
    } catch (enrichErr) {
      // Do not fail the request on enrichment errors; log and proceed with original docs.
      try {
        console.warn('[llm-costs] user enrichment failed:', enrichErr?.message || enrichErr);
        res.set('X-Users-Enriched', 'error');
      } catch {}
    }

    // Diagnostics
    res.set('X-DB-Connected', String(isDbConnected()));
    res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
    res.set('X-Query-Duration', String(Date.now() - t0));

    if (hasPagination) {
      let total = 0;
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: 1500 });
      } catch (_) {
        // deterministic fallback without extra DB roundtrips
        total = docs.length + skip;
      }
      clearTimeout(hardTimer);
      return res.status(200).json({
        success: true,
        data: docs,
        meta: { page: safePage, limit, total },
      });
    }

    // Raw array when no pagination requested
    clearTimeout(hardTimer);
    return res.status(200).json(docs);
  } catch (err) {
    try { res.set('X-Query-Duration', String(Date.now() - t0)); } catch {}
    clearTimeout(hardTimer);
    return next(err);
  } finally {
    // If hard-timeout fired and we already responded, ensure timer cleared
    if (!hardTimeoutFired) {
      try { clearTimeout(hardTimer); } catch {}
    }
  }
}

module.exports = { listLLMCosts };
