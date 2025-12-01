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

    // Resolve organization filter:
    // - Prefer middleware scoping (req.tenantId) when present and not bypassed
    // - Else use header or query value if provided
    // - If none provided and bypass is active, or no scoping determined, return all
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
      // Some data uses 'project' vs 'projects'; include both, clients expect arrays present
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
        .maxTimeMS(5000);

      docs = await cursor.toArray();

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
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : '');
      res.set('X-Query-Duration', String(Date.now() - t0));
      return res.status(timedOut ? 504 : 500).json({ success: false, error: timedOut ? 'Query timed out' : 'Query failed' });
    }

    // Batched enrichment: fetch full user docs for all users[].user_id across returned docs
    try {
      // 1) Collect distinct user ids as strings (defensive trim + String)
      const allIdsSet = new Set();
      for (const d of docs) {
        if (Array.isArray(d.users)) {
          for (const u of d.users) {
            // Only consider users[].user_id; _id in users collection is a string/UUID
            const raw = u?.user_id ?? null;
            if (raw !== null && raw !== undefined) {
              const s = String(raw).trim();
              if (s) allIdsSet.add(s);
            }
          }
        }
      }

      // Minimal diagnostics on first few ids
      const firstFew = Array.from(allIdsSet).slice(0, 5);

      if (allIdsSet.size > 0) {
        const usersColl = db.collection('users');

        // 2) Directly query users by _id using $in with string UUIDs (no ObjectId conversion)
        const ids = Array.from(allIdsSet);
        const userQuery = { _id: { $in: ids } }; // _id is stored as string UUID
        const userProjection = {
          _id: 1, // string UUID
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
          .maxTimeMS(4000)
          .toArray();

        // 3) Build user map keyed by String(doc._id)
        const userMap = {};
        for (const u of foundUsers) {
          if (u && u._id != null) {
            userMap[String(u._id)] = u;
          }
        }

        // 4) Attach matches: users[i].user = userMap[String(users[i].user_id)] || null
        for (const d of docs) {
          if (Array.isArray(d.users)) {
            d.users = d.users.map((entry) => {
              const key = entry?.user_id != null ? String(entry.user_id).trim() : '';
              const enriched = { ...entry };
              enriched.user = key ? userMap[String(key)] || null : null;
              return enriched;
            });
          }
        }

        // Diagnostics headers (optional): indicate match field used
        try {
          const enrichedCount = Object.keys(userMap).length;
          res.set('X-Users-Enriched', `${enrichedCount}/${allIdsSet.size}`);
          // One-time debug header to record which field was used for matching
          res.set('X-Users-Match-Field', '_id'); // _id is a string UUID
          if (firstFew.length > 0) {
            res.set('X-Users-Sample-Ids', firstFew.join(',').slice(0, 128));
          }
        } catch {}
      } else {
        try {
          res.set('X-Users-Enriched', '0/0');
        } catch {}
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
        total = await collection.countDocuments(filter, { maxTimeMS: 2000 });
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
