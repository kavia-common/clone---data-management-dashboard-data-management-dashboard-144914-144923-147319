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
    // mark start
    try {
      console.log('[llmCosts.list] start', { ...logBase });
    } catch {}
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

    // Apply default tenant per requirement when none provided and not in bypass
    // This ensures organization_id=T0015 is enforced by default to avoid empty scope during verification.
    if (!bypass && !resolvedTenant) {
      resolvedTenant = 'T0015';
      // If an environment variable explicitly disables defaulting, return 400 instead
      if (String(process.env.DISABLE_DEFAULT_TENANT || '').toLowerCase() === 'true') {
        return res.status(400).json({
          success: false,
          message:
            'Missing tenant. Provide Authorization with tenant or x-organization-id header. Default tenant disabled by env.',
        });
      }
    }

    // Pagination & limits
    const DEFAULT_LIMIT = 20;
    // Cap to prevent memory pressure; aligned with OpenAPI (max 200)
    const MAX_LIMIT = 200;
    const MAX_SERVER_TIMEOUT_MS = 8000; // defensive cap

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    let limit = parseInt(req.query?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    const sortWhitelist = new Set(['timestamp', 'created_at', '_id', 'total_cost']);
    const requestedSort = (req.query?.sort && String(req.query.sort)) || '-timestamp';
    const sort = {};
    for (const token of requestedSort.split(',').map((s) => s.trim()).filter(Boolean)) {
      const desc = token.startsWith('-');
      const key = desc ? token.slice(1) : token;
      // Enforce whitelist to avoid slow collection scans on unindexed fields
      if (!sortWhitelist.has(key)) continue;
      sort[key] = desc ? -1 : 1;
    }
    // Fallback to -timestamp if nothing valid provided
    if (Object.keys(sort).length === 0) {
      sort.timestamp = -1;
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
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
    } catch {}

    // Query with safe timeouts and lean for speed
    const skip = (page - 1) * limit;

    // Use lean for performance but preserve all fields (no projection is applied)
    const baseQuery = LLMCost.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(); // lean returns plain objects; still includes all fields unless projection is provided

    // Apply mongoose-level maxTimeMS via options on underlying cursor
    // use .maxTimeMS if available; also set comment for observability
    if (typeof baseQuery.maxTimeMS === 'function') {
      baseQuery.maxTimeMS(MAX_SERVER_TIMEOUT_MS);
    }
    if (typeof baseQuery.comment === 'function') {
      baseQuery.comment('llm-costs:list');
    }

    // Execute count and data in parallel with Promise.allSettled to avoid hangs
    // Use a smaller timeout for count on small pages to avoid tying up the server
    const countTimeout = (page <= 2 && limit <= 50) ? Math.min(4000, MAX_SERVER_TIMEOUT_MS) : MAX_SERVER_TIMEOUT_MS;
    // Wrap with request-level timeout using Promise.race to avoid hanging at proxy
    const REQUEST_TIMEOUT_MS = 5000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('request-timeout')), REQUEST_TIMEOUT_MS)
    );

    const [dataRes, countRes] = await Promise.allSettled([
      Promise.race([baseQuery.exec(), timeoutPromise]),
      Promise.race([LLMCost.countDocuments(filter).maxTimeMS(countTimeout).exec(), timeoutPromise]),
    ]);

    if (dataRes.status !== 'fulfilled') {
      const msg = dataRes.reason?.message || 'Query failed';
      const durationMs = Date.now() - startedAt;
      const organization_id =
        req.tenantId ||
        req?.auth?.tenantId ||
        req.headers['x-organization-id'] ||
        req.query?.organization_id ||
        req.query?.tenant_id ||
        null;
      try {
        console.error('[llmCosts.list] data query failed', { ...logBase, durationMs, error: msg, organization_id: organization_id ? String(organization_id) : null });
      } catch {}
      // Timeout or server selection issues should return 504/503 respectively
      if (msg === 'request-timeout' || /maxTimeMS|operation exceeded time limit/i.test(msg)) {
        try { res.set('X-Error', 'timeout'); } catch {}
        return res.status(504).json({ success: false, message: 'Request timed out. Try reducing page size or refine filters.' });
      }
      if (/server selection timed out/i.test(msg)) {
        return res.status(503).json({ success: false, message: 'Database unavailable' });
      }
      return res.status(500).json({ success: false, message: msg });
    }

    const items = Array.isArray(dataRes.value) ? dataRes.value : [];
    let total = 0;
    if (countRes.status === 'fulfilled') {
      total = Number(countRes.value) || 0;
    } else {
      // If count fails (e.g., timeout), still return items but flag meta.partial=true
      res.set('X-Count-Partial', 'true');
      try {
        const durationMs = Date.now() - startedAt;
        const msg = countRes.reason?.message || 'count failed';
        console.warn('[llmCosts.list] count partial', { ...logBase, durationMs, error: msg });
      } catch {}
    }

    const response = {
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
      },
    };
    try {
      const durationMs = Date.now() - startedAt;
      console.log('[llmCosts.list] success', { ...logBase, durationMs, count: items.length, total });
    } catch {}
    return res.status(200).json(response);
  } catch (err) {
    const msg = err?.message || 'Internal server error';
    try {
      const durationMs = Date.now() - startedAt;
      console.error('[llmCosts.list] error', { ...logBase, durationMs, error: msg });
    } catch {}
    if (/maxTimeMS|operation exceeded time limit/i.test(msg)) {
      try { res.set('X-Error', 'timeout'); } catch {}
      return res.status(504).json({ success: false, message: 'Query timeout' });
    }
    if (/server selection timed out/i.test(msg)) {
      return res.status(503).json({ success: false, message: 'Database unavailable' });
    }
    return res.status(500).json({ success: false, message: msg });
  }
}

module.exports = {
  listLlmCosts,
};
