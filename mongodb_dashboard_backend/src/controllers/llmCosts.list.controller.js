'use strict';

const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * Lists LLM cost records with tenant scoping, safe pagination, sort, and server-side timeouts.
 * Fast-fails when tenant cannot be resolved (unless bypass mode).
 */
async function listLlmCosts(req, res) {
  try {
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

    // Fast-fail if no tenant in non-bypass mode
    if (!bypass && !resolvedTenant) {
      return res.status(400).json({
        success: false,
        message: 'Missing tenant. Provide Authorization with tenant or x-organization-id header',
      });
    }

    // Pagination & limits
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 200;
    const MAX_SERVER_TIMEOUT_MS = 8000; // defensive cap

    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    let limit = parseInt(req.query?.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    const sortStr = (req.query?.sort && String(req.query.sort)) || '-timestamp';
    const sort = {};
    // Convert sort string to mongoose sort object; allow leading '-' for desc
    for (const token of sortStr.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (token.startsWith('-')) {
        sort[token.slice(1)] = -1;
      } else {
        sort[token] = 1;
      }
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

    const baseQuery = LLMCost.find(filter).sort(sort).skip(skip).limit(limit).lean();

    // Apply mongoose-level maxTimeMS via options on underlying cursor
    // use .maxTimeMS if available; also set comment for observability
    if (typeof baseQuery.maxTimeMS === 'function') {
      baseQuery.maxTimeMS(MAX_SERVER_TIMEOUT_MS);
    }
    if (typeof baseQuery.comment === 'function') {
      baseQuery.comment('llm-costs:list');
    }

    // Execute count and data in parallel with Promise.allSettled to avoid hangs
    const [dataRes, countRes] = await Promise.allSettled([
      baseQuery.exec(),
      LLMCost.countDocuments(filter).maxTimeMS(MAX_SERVER_TIMEOUT_MS).exec(),
    ]);

    if (dataRes.status !== 'fulfilled') {
      const msg = dataRes.reason?.message || 'Query failed';
      // Timeout or server selection issues should return 504/503 respectively
      if (/maxTimeMS|operation exceeded time limit/i.test(msg)) {
        return res.status(504).json({ success: false, message: 'Query timeout' });
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
    }

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        total,
      },
    });
  } catch (err) {
    const msg = err?.message || 'Internal server error';
    if (/maxTimeMS|operation exceeded time limit/i.test(msg)) {
      return res.status(504).json({ success: false, message: 'Query timeout' });
    }
    return res.status(500).json({ success: false, message: msg });
  }
}

module.exports = {
  listLlmCosts,
};
