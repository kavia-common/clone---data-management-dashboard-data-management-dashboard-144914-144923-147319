'use strict';

const mongoose = require('mongoose');
const { isDBReadyFast, isDbConnected, getDb } = require('../config/db');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Hardened handler to prevent 500s and ERR_HTTP_HEADERS_SENT:
 * - Single-response guarantee via early returns and a responded guard.
 * - Removed racey hard timeout sender; only internal timeouts on queries/enrichment with headers set.
 * - Preserves users[] array shape and users[].user_cost during enrichment.
 * - Null-safe checks for users/projects arrays.
 */
async function listLLMCosts(req, res, next) {
  const t0 = Date.now();

  // One-time debug diagnostics
  let debugOnce = String(process.env.BACKEND_DEBUG_ONCE || '').toLowerCase() === 'true';
  const debugInfo = (label, data) => {
    try {
      if (debugOnce) console.debug(`[llm-costs DEBUG] ${label}:`, data);
    } catch {}
  };

  // Single-response guard
  let responded = false;
  const safeSend = (status, body) => {
    if (responded || res.headersSent) return;
    try { res.set('X-Query-Duration', String(Date.now() - t0)); } catch {}
    res.status(status).json(body);
    responded = true;
  };

  try {
    // Fail fast if DB is not configured
    if (!process.env.MONGODB_URI) {
      try {
        res.set('X-DB-Connected', 'false');
        res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      } catch {}
      return safeSend(503, {
        success: false,
        error: 'Database not configured',
        detail: 'MONGODB_URI is missing',
      });
    }

    // Quick readiness probe
    const readiness = await isDBReadyFast(800);
    if (!readiness.ok) {
      try {
        res.set('X-DB-Connected', 'false');
        res.set('X-Org-Filter', String(req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id || ''));
      } catch {}
      return safeSend(503, {
        success: false,
        error: 'Database not ready',
        detail: readiness.reason || 'unknown',
      });
    }

    // Opportunistic connect if not connected (non-blocking)
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
    if (resolvedTenant) filter.organization_id = String(resolvedTenant);

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

    debugInfo('Incoming query', {
      org_header: req.headers['x-organization-id'],
      org_query: req.query.organization_id || req.query.tenant_id,
      resolvedTenant,
      page: safePage,
      limit,
      skip,
    });

    let docs = [];
    try {
      const cursor = collection
        .find(filter, { projection })
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .maxTimeMS(4000);

      docs = await cursor.toArray();

      // Ensure arrays present even if absent in source document
      docs = (Array.isArray(docs) ? docs : []).map((d) => {
        const out = d && typeof d === 'object' ? { ...d } : {};
        try {
          if (!Array.isArray(out.users)) {
            // if truthy but not array, keep as-is; else set []
            out.users = Array.isArray(out.users) ? out.users : (out.users ? out.users : []);
          }
          if (!Array.isArray(out.projects)) {
            if (Array.isArray(out.project)) out.projects = out.project;
            else out.projects = [];
          }
          if (!Array.isArray(out.agents)) {
            out.agents = Array.isArray(out.agents) ? out.agents : (out.agents ? out.agents : []);
          }
        } catch {}
        return out;
      });
    } catch (e) {
      const timedOut = e && (e.code === 50 || /exceeded time limit|network timeout|timed out/i.test(String(e.message)));
      try {
        res.set('X-DB-Connected', String(isDbConnected()));
        res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : '');
      } catch {}
      if (debugOnce) {
        console.error('[llm-costs] find failed:', { message: e?.message, code: e?.code, stack: e?.stack });
        process.env.BACKEND_DEBUG_ONCE = 'false';
      }
      return safeSend(timedOut ? 504 : 500, { success: false, error: timedOut ? 'Query timed out' : 'Query failed' });
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
        // Ensure string-based join: user collection uses string UUIDs in _id
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
          if (debugOnce) console.warn('[llm-costs] user enrichment query failed:', e?.message || e);
        }

        const userMap = {};
        for (const u of foundUsers) {
          if (u && u._id != null) userMap[String(u._id)] = u;
        }

        // Null-safe mapping; preserve user_cost and original shape
        for (const d of docs) {
          if (Array.isArray(d.users)) {
            d.users = d.users.map((entry) => {
              try {
                const key = entry && entry.user_id != null ? String(entry.user_id).trim() : '';
                const enriched = { ...entry };
                enriched.user = key ? (userMap[key] || null) : null;
                return enriched;
              } catch {
                return entry;
              }
            });
          } else if (!d.users) {
            d.users = [];
          }
        }

        try {
          const enrichedCount = Object.keys(userMap).length;
          res.set('X-Users-Enriched', `${enrichedCount}/${allIdsSet.size}`);
          res.set('X-Users-Match-Field', '_id');
          if (firstFew.length > 0) res.set('X-Users-Sample-Ids', firstFew.join(',').slice(0, 128));
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

    // Diagnostics and headers
    try {
      res.set('X-DB-Connected', String(isDbConnected()));
      res.set('X-Org-Filter', resolvedTenant ? String(resolvedTenant) : (superAdminBypass ? 'all-tenants' : ''));
      res.set('X-Query-Duration', String(Date.now() - t0));
    } catch {}

    if (hasPagination) {
      let total = 0;
      try {
        total = await collection.countDocuments(filter, { maxTimeMS: 1500 });
      } catch (e) {
        // fallback if count times out/fails
        total = docs.length + skip;
        if (debugOnce) console.warn('[llm-costs] countDocuments failed, using fallback:', e?.message || e);
      }
      if (debugOnce) {
        console.debug('[llm-costs DEBUG] returning envelope page', { page: safePage, limit, total, items: docs.length });
        process.env.BACKEND_DEBUG_ONCE = 'false';
        debugOnce = false;
      }
      return safeSend(200, {
        success: true,
        data: docs,
        meta: { page: safePage, limit, total },
      });
    }

    // Raw array when no pagination requested
    if (debugOnce) {
      console.debug('[llm-costs DEBUG] returning raw array', { count: Array.isArray(docs) ? docs.length : 0 });
      process.env.BACKEND_DEBUG_ONCE = 'false';
      debugOnce = false;
    }
    return safeSend(200, Array.isArray(docs) ? docs : []);
  } catch (err) {
    // Safe error response instead of unhandled exception
    const status = err.status || err.statusCode || 500;
    if (debugOnce) {
      console.error('[llm-costs] handler failed:', err?.message || err, err?.stack);
      process.env.BACKEND_DEBUG_ONCE = 'false';
    }
    return safeSend(status, { success: false, error: err?.message || 'Internal Server Error' });
  }
}

module.exports = { listLLMCosts };
