'use strict';

const mongoose = require('mongoose');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLLMCosts
 * GET /api/llm-costs
 *
 * Purpose:
 *  - Return documents from llm-costs collection with proper pagination and optional tenant filter.
 *  - Do NOT unwind users here; dedicated per-user listing lives at /api/llm-costs/users.
 *
 * Performance and safety:
 *  - Enforces reasonable default pagination (page=1, limit=20 capped at 200).
 *  - Enforces tenant-scoped $match first to leverage indexes and avoid collection scans.
 *  - Restricts sort keys to indexed date fields and _id for stability.
 *  - Applies MongoDB maxTimeMS to avoid gateway timeouts on slow aggregations.
 *  - Avoids heavy computed fields when not needed for listing.
 *
 * Response (ListEnvelope):
 *  - { success: true, data: [doc...], meta: { page, limit, total } }
 *
 * Query params:
 *  - organization_id (alias tenant_id or x-organization-id header) for scoping
 *  - page (default 1), limit (default 20, max 200)
 *  - sort (defaults to createdAt desc, then timestamp, created_at, _id)
 */
// PUBLIC_INTERFACE
async function listLLMCosts(req, res, next) {
  try {
    const {
      page: pageRaw,
      limit: limitRaw,
      sort: sortRaw,
      organization_id: orgQuery,
      tenant_id: tenantQuery,
    } = req.query;

    // Resolve tenant scope (JWT via upstream, else header, else query)
    const headerTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      undefined;

    const resolvedTenant = req.tenantId || headerTenant || orgQuery || tenantQuery || undefined;

    // Basic input validation: page/limit must be positive integers
    if (pageRaw && (!/^[0-9]+$/.test(String(pageRaw)) || parseInt(pageRaw, 10) < 1)) {
      return res.status(400).json({ success: false, message: 'Invalid page parameter' });
    }
    if (limitRaw && (!/^[0-9]+$/.test(String(limitRaw)) || parseInt(limitRaw, 10) < 1)) {
      return res.status(400).json({ success: false, message: 'Invalid limit parameter' });
    }

    // Parse sort; allow only known sortable fields to keep index usage optimal
    const allowedSortKeys = new Set(['createdAt', 'timestamp', 'created_at', '_id']);
    let sortStage = {};
    if (sortRaw && typeof sortRaw === 'string' && sortRaw.trim()) {
      sortRaw.split(',').forEach((s) => {
        const v = s.trim();
        if (!v) return;
        const dir = v.startsWith('-') ? -1 : 1;
        const key = v.startsWith('-') ? v.slice(1) : v;
        if (allowedSortKeys.has(key)) sortStage[key] = dir;
      });
    }
    if (!Object.keys(sortStage).length) {
      // Prefer createdAt then fallback to timestamp/created_at and always _id desc for stability
      sortStage = { createdAt: -1, timestamp: -1, created_at: -1, _id: -1 };
    }

    // Pagination: default envelope pagination with conservative defaults for performance
    // Default limit=20 but if not explicitly provided, cap at 50 max. If user provides higher, clamp to 200.
    const page = Math.max(parseInt(pageRaw, 10) || 1, 1);
    const userLimit = parseInt(limitRaw, 10);
    const defaultLimit = 20;
    const computedLimit = Number.isFinite(userLimit) && userLimit > 0 ? userLimit : defaultLimit;
    // Hard caps: default flow must never exceed 50, absolute cap 200 for explicit requests
    const hardMaxDefault = 50;
    const hardMax = 200;
    const limit = Math.min(computedLimit, userLimit ? hardMax : hardMaxDefault);
    const skip = (page - 1) * limit;

    // Tenant match (optional if not provided/resolved). Keep it first to use compound indexes.
    const match = {};
    if (resolvedTenant) {
      const t = String(resolvedTenant);
      match.$or = [
        { organization_id: t },
        { tenant_id: t },
        { organizationId: t },
        { tenantId: t },
        { orgId: t },
        { 'tenant.tenant_id': t },
      ];
    }

    // Minimal projection to avoid unnecessary work
    const projection = {
      _id: 1,
      organization_id: 1,
      tenant_id: 1,
      organizationId: 1,
      tenantId: 1,
      orgId: 1,
      organization_name: 1,
      tenant_name: 1,
      organization: 1,
      'tenant.name': 1,
      organization_cost: 1,
      total_cost: 1,
      total: 1,
      cost: 1,
      createdAt: 1,
      timestamp: 1,
      created_at: 1,
      users: 1,
      project: 1,
      projects: 1,
      agents: 1,
      Agents: 1,
    };

    const pipeline = [
      Object.keys(match).length ? { $match: match } : { $match: {} },
      { $sort: sortStage },
      { $project: projection },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    // Apply a strict aggregation timeout and batch size to prevent long/hanging queries
    const maxTime = parseInt(process.env.MONGO_QUERY_TIMEOUT_MS || '8000', 10); // 8s default per SLA
    const agg = LLMCost.aggregate(pipeline).allowDiskUse(true);
    // batchSize limits memory usage during aggregation cursor iteration
    if (typeof agg.cursor === 'function') {
      try { agg.cursor({ batchSize: Math.max(50, Math.min(200, limit)) }); } catch (_) {}
    }
    if (typeof agg.maxTimeMS === 'function') {
      agg.maxTimeMS(Math.max(1000, maxTime));
    }

    const result = await agg.exec();
    const dataRaw = result?.[0]?.data || [];
    const total = result?.[0]?.totalCount?.[0]?.count || 0;

    // Normalize a few fields cheaply on the app side to avoid $addFields compute cost in Mongo
    const data = dataRaw.map((doc) => {
      const d = { ...doc };
      // Normalize organization id and name for client convenience
      d.organization_id =
        d.organization_id ||
        d.organizationId ||
        d.tenant_id ||
        d.tenantId ||
        d.orgId ||
        (d.tenant && d.tenant.tenant_id) ||
        null;

      d.organization_name =
        d.organization_name ||
        d.tenant_name ||
        d.organization ||
        (d.tenant && d.tenant.name) ||
        null;

      // Normalize cost
      const costCandidate = d.organization_cost ?? d.total_cost ?? d.total ?? d.cost ?? 0;
      d.organization_cost = typeof costCandidate === 'number' ? costCandidate : Number(costCandidate) || 0;

      // Keep users/projects/agents as-is; avoid unwinding here
      return d;
    });

    // Diagnostics headers
    try {
      if (resolvedTenant) res.set('X-Applied-Tenant', String(resolvedTenant));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      res.set('X-MaxTimeMS', String(Math.max(1000, maxTime)));
    } catch {}

    // Always return envelope for consistent client experience
    return res.status(200).json({
      success: true,
      data,
      meta: { page, limit, total },
    });
  } catch (err) {
    // If the aggregation exceeded time limit, convert to 504 for clarity
    if (err && (err.code === 50 || /exceeded time limit/i.test(String(err.message || '')))) {
      return res.status(504).json({
        success: false,
        message: 'Aggregation exceeded time limit. Try narrowing the tenant or time range, or lower page size.',
      });
    }
    return next(err);
  }
}

module.exports = {
  listLLMCosts,
};
