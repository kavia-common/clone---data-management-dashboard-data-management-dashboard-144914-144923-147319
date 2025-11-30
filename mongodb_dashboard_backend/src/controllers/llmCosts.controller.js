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
