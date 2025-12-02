'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Lists LLM cost records with tenant scoping, safe pagination, sort, and server-side timeouts.
 * Fast-fails when tenant cannot be resolved (unless bypass mode).
 */
async function listLlmCosts(req, res) {
  const startedAt = Date.now();
  const reqId = `${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const logBase = {
    reqId,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
  };
  try {
    // start timing log
    try { console.log('[llmCosts.list] start', { ...logBase }); } catch {}

    // Bypass mode (Super Admin/T0000)
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);

    // Resolve tenant: priority JWT -> header -> query
    let resolvedTenant = req.tenantId || req?.auth?.tenantId || '';
    if (!resolvedTenant) {
      const hdrOrg =
        (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        '';
      const qOrg =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        '';
      resolvedTenant = hdrOrg || qOrg || '';
    }

    // If Authorization is present, enforce tenant match with any provided hint
    if (req.headers?.authorization && resolvedTenant && req.tenantId && String(resolvedTenant) !== String(req.tenantId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    // Require tenant unless bypass; do not set hard-coded defaults here
    if (!bypass && !resolvedTenant) {
      return res.status(400).json({
        success: false,
        message: 'Missing tenant. Provide Authorization with tenant or x-organization-id header/query alias.',
      });
    }

    // Pagination & limits
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 200;

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    let limit = parseInt(req.query?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    // Restrict sort to safe, indexed fields only
    const sortWhitelist = new Set(['created_at', 'total_cost']);
    const requestedSort = (req.query?.sort && String(req.query.sort)) || '-created_at';
    const sort = {};
    for (const token of requestedSort.split(',').map((s) => s.trim()).filter(Boolean)) {
      const desc = token.startsWith('-');
      const key = desc ? token.slice(1) : token;
      if (!sortWhitelist.has(key)) continue;
      sort[key] = desc ? -1 : 1;
    }
    if (Object.keys(sort).length === 0) {
      sort.created_at = -1; // default to created_at desc
    }

    // Build filter from query.filter (tenant fields ignored) + enforced tenant filter
    let userFilter = {};
    if (req.query?.filter) {
      try {
        userFilter = JSON.parse(String(req.query.filter));
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }
    // Remove any user-provided tenant fields
    delete userFilter.tenant_id;
    delete userFilter.tenantId;
    delete userFilter.organization_id;
    delete userFilter.organizationId;
    delete userFilter['tenant.tenant_id'];

    // Enforced tenant filter (unless bypass)
    let tenantFilter = {};
    if (!bypass && resolvedTenant) {
      const t = String(resolvedTenant);
      tenantFilter = {
        $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }],
      };
    }
    const filter = Object.keys(userFilter).length
      ? (Object.keys(tenantFilter).length ? { $and: [userFilter, tenantFilter] } : userFilter)
      : tenantFilter;

    // Add diagnostic headers
    try {
      if (bypass) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (resolvedTenant) {
        res.set('X-Applied-Tenant', String(resolvedTenant));
        res.set('X-Applied-Filter', JSON.stringify(filter));
      }
    } catch {}

    // Enforce strict query deadlines
    const FIND_MAX_MS = Math.max(1500, Math.min(2000, parseInt(process.env.LLM_COSTS_FIND_MAX_MS || '2000', 10) || 2000));
    const COUNT_MAX_MS = Math.max(1500, Math.min(2000, parseInt(process.env.LLM_COSTS_COUNT_MAX_MS || '1800', 10) || 1800));
    const skip = (page - 1) * limit;

    // Ensure critical indexes best-effort (non-blocking)
    try {
      if (typeof LLMCost.ensureLLMCostsIndexes === 'function') {
        LLMCost.ensureLLMCostsIndexes().catch(() => {});
      }
    } catch {}

    // Build queries with lean for speed and maxTimeMS enforced
    const dataQuery = LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean();
    if (typeof dataQuery.maxTimeMS === 'function') dataQuery.maxTimeMS(FIND_MAX_MS);
    if (typeof dataQuery.comment === 'function') dataQuery.comment('llm-costs:list:data');

    const countQuery = LLMCost.countDocuments(filter);
    if (typeof countQuery.maxTimeMS === 'function') countQuery.maxTimeMS(COUNT_MAX_MS);
    if (typeof countQuery.comment === 'function') countQuery.comment('llm-costs:list:count');

    // Execute with Promise.allSettled to avoid rejection short-circuit
    const [dataRes, countRes] = await Promise.allSettled([dataQuery.exec(), countQuery.exec()]);

    // If data timed out, immediately return bounded response
    if (dataRes.status !== 'fulfilled') {
      const msg = dataRes.reason?.message || 'Query failed';
      const durationMs = Date.now() - startedAt;
      try { console.warn('[llmCosts.list] data timeout/failure', { ...logBase, durationMs, error: msg }); } catch {}
      if (/maxTimeMS|operation exceeded time limit|exceeded time limit|MongoServerError:.*Time/i.test(msg)) {
        try { res.set('X-Error', 'timeout'); } catch {}
        return res.status(200).json({
          items: [],
          page,
          limit,
          total: 0,
          timed_out: true,
        });
      }
      if (/server selection timed out/i.test(msg)) {
        return res.status(200).json({
          items: [],
          page,
          limit,
          total: 0,
          timed_out: true,
        });
      }
      // Non-timeout failure: still return bounded response
      return res.status(200).json({
        items: [],
        page,
        limit,
        total: 0,
        timed_out: true,
      });
    }

    const items = Array.isArray(dataRes.value) ? dataRes.value : [];
    let total = 0;
    let timed_out = false;
    if (countRes.status === 'fulfilled') {
      total = Number(countRes.value) || 0;
    } else {
      timed_out = true;
      try { res.set('X-Count-Partial', 'true'); } catch {}
      try {
        const durationMs = Date.now() - startedAt;
        console.warn('[llmCosts.list] count timed out/failed', { ...logBase, durationMs, error: countRes.reason?.message });
      } catch {}
    }

    // Envelope response (bounded and fast)
    const durationMs = Date.now() - startedAt;
    try { console.log('[llmCosts.list] success', { ...logBase, durationMs, count: items.length, total, timed_out }); } catch {}
    return res.status(200).json({
      success: true,
      data: items,
      meta: { page, limit, total, timed_out },
    });
  } catch (err) {
    const msg = err?.message || 'Internal server error';
    const durationMs = Date.now() - startedAt;
    try { console.error('[llmCosts.list] error', { ...logBase, durationMs, error: msg }); } catch {}
    // On any error, fail safe with bounded response per requirement
    if (/maxTimeMS|operation exceeded time limit|exceeded time limit|server selection timed out/i.test(msg)) {
      try { res.set('X-Error', 'timeout'); } catch {}
      return res.status(200).json({
        items: [],
        page: Math.max(1, parseInt(req.query?.page, 10) || 1),
        limit: Math.min(parseInt(req.query?.limit, 10) || 20, 200),
        total: 0,
        timed_out: true,
      });
    }
    return res.status(200).json({
      items: [],
      page: Math.max(1, parseInt(req.query?.page, 10) || 1),
      limit: Math.min(parseInt(req.query?.limit, 10) || 20, 200),
      total: 0,
      timed_out: true,
    });
  }
}

module.exports = {
  listLlmCosts,
};
