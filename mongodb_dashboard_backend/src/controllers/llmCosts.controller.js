'use strict';

const { success, handleError } = require('../utils/http');
const { aggregateHierarchy, ensureLlmCostsIndexes } = require('../services/llmCostsHierarchy.service');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * listLlmCosts
 * GET /api/llm-costs
 * Returns full LLM cost documents, quickly. Defaults to:
 *  - sort: -timestamp (if present)
 *  - limit: 100 (to avoid huge payloads), can be overridden up to 200
 * Tenant scoping is enforced similar to other routes. If explicit pagination (page/limit)
 * is provided, returns envelope; otherwise raw array.
 */
async function listLlmCosts(req, res) {
  try {
    // Parse filter safely
    let filter = {};
    if (req.query && req.query.filter) {
      try { filter = JSON.parse(req.query.filter); }
      catch { return res.status(400).json({ success: false, message: 'Invalid filter JSON' }); }
    }

    // Drop any tenant keys from client filter
    delete filter.tenant_id;
    delete filter.tenantId;
    delete filter.organization_id;
    delete filter.organizationId;
    delete filter.orgId;

    // Resolve tenant with bypass support (T0000 etc)
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
    const resolvedTenant = bypass
      ? undefined
      : (req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined));

    if (req.headers?.authorization) {
      const clientRequestedTenant =
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) || '';
      if (clientRequestedTenant && String(clientRequestedTenant) !== String(resolvedTenant || '')) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
    }

    if (resolvedTenant) {
      const t = String(resolvedTenant);
      const tenantOr = {
        $or: [
          { tenant_id: t },
          { organization_id: t },
          { orgId: t },
          { tenantId: t },
          { organizationId: t },
          { 'tenant.tenant_id': t },
        ],
      };
      filter = Object.keys(filter).length ? { $and: [filter, tenantOr] } : tenantOr;
      try { res.set('X-Applied-Tenant', t); } catch {}
    } else if (bypass) {
      try { res.set('X-All-Tenants', 'true'); res.set('X-Applied-Tenant', 'all-tenants'); } catch {}
    }

    // Sorting: default -timestamp, fallback to -_id
    const sortStr = (req.query?.sort || '-timestamp').toString();
    const sort = {};
    for (const token of sortStr.split(',').map(s => s.trim()).filter(Boolean)) {
      const dir = token.startsWith('-') ? -1 : 1;
      const key = token.replace(/^-/, '');
      sort[key] = dir;
    }
    if (Object.keys(sort).length === 0) sort._id = -1;

    // Pagination handling
    const limitParam = Number(req.query?.limit);
    const pageParam = Number(req.query?.page);
    const explicitPagination = Number.isFinite(limitParam) || Number.isFinite(pageParam);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(200, limitParam)) : 100;
    const page = Number.isFinite(pageParam) ? Math.max(1, pageParam) : 1;
    const skip = (page - 1) * limit;

    // Fast path when no explicit pagination: limit default to 100 and return array
    // Always use lean() to reduce memory overhead and speed up JSON serialization
    // Try to apply common index hint for speed if present
    let cursor = LLMCost.find(filter, null, { strictQuery: true }).sort(sort).lean();
    try { cursor = cursor.hint({ tenant_id: 1, timestamp: -1 }); } catch {}
    cursor = explicitPagination ? cursor.skip(skip).limit(limit) : cursor.limit(limit);

    const docs = await cursor.exec();

    if (!explicitPagination) {
      // Raw array
      return res.status(200).json(docs);
    }

    // Envelope response
    const total = await LLMCost.countDocuments(filter).exec();
    return res.status(200).json({
      success: true,
      data: docs,
      meta: { page, limit, total },
    });
  } catch (err) {
    return handleError(res, err);
  }
}

// PUBLIC_INTERFACE
async function getHierarchy(req, res) {
  /**
   * PUBLIC_INTERFACE
   * Handler: GET /api/llm-costs/hierarchy
   * Aggregates hierarchical costs per user -> projects -> agents with per-date breakdown.
   * Query:
   *  - filter: optional JSON string to pre-filter the llm_costs collection (tenant keys ignored)
   * Returns: Array of:
   * Tenant scoping: server enforces tenant from header x-organization-id (preferred) or query ?tenant_id/?organization_id; any client-provided tenant keys in filter are ignored.
   *   { user_id, type: 'llm_interaction', user_cost: '$X.XX', projects: [ { project_id, project_cost: '$Y.YY', agents: [ { agent_name, total_cost: '$..', costs_by_date: { 'YYYY-MM-DD': '$..' }, tokens_by_date: { 'YYYY-MM-DD': { input_tokens, output_tokens } } } ] } ] }
   */
  try {
    // Optional filter from query
    let filter = {};
    if (req.query && req.query.filter) {
      try {
        filter = JSON.parse(req.query.filter);
      } catch (e) {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    // Enforce tenant scoping: drop any tenant keys from client filter and inject resolved tenant
    delete filter.tenant_id;
    delete filter.tenantId;
    delete filter.organization_id;
    delete filter.organizationId;
    delete filter.orgId;

    // JWT precedence check: if Authorization present and client hints conflict, reject with 403
    const clientRequestedTenant =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      '';
    if (req.headers?.authorization && clientRequestedTenant && String(clientRequestedTenant) !== String(req.tenantId || '')) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass);
    const resolvedTenant = bypass ? undefined : (req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined));
    if (bypass) {
      try { res.set('X-All-Tenants', 'true'); } catch(_) {}
      console.log('[llmCosts.controller] bypass active: skipping tenant filter injection');
    }
    if (resolvedTenant) {
      const orgFilter = {
        $or: [
          { tenant_id: String(resolvedTenant) },
          { organization_id: String(resolvedTenant) },
          { orgId: String(resolvedTenant) },
          { tenantId: String(resolvedTenant) },
          { organizationId: String(resolvedTenant) },
          { 'tenant.tenant_id': String(resolvedTenant) },
        ],
      };
      filter = Object.keys(filter).length ? { $and: [filter, orgFilter] } : orgFilter;
    }

    // Best-effort index creation (non-blocking); ignore errors
    ensureLlmCostsIndexes().catch(() => {});

    const data = await aggregateHierarchy({ filter, tenantId: resolvedTenant });
    try {
      if (resolvedTenant) {
        res.set('X-Applied-Tenant', String(resolvedTenant));
        res.set('x-applied-organization-id', String(resolvedTenant));
        res.set('x-applied-tenant-filter', JSON.stringify(filter));
      }
    } catch (_) {}
    return success(res, data);
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = {
  getHierarchy,
};
