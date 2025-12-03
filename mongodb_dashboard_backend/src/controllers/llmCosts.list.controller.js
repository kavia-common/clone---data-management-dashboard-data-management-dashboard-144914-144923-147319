'use strict';

const LLMCost = require('../models/llmCosts.model');
const { success } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * list
 * Handler: GET /api/llm-costs
 * Returns list of LLM cost documents with strict pagination clamp, lean projection, Mongo maxTimeMS,
 * and a route-level timeout handled by the caller (routes layer).
 * - Default limit=10, max=200. If no explicit pagination provided, returns raw array (guarded by 50 items).
 * - Enforces tenant scoping using req.tenantId/organizationId unless bypass flags are set.
 * - Always returns JSON: 200 on success; 206 with minimal payload if maxTimeMS exceeded.
 */
async function list(req, res) {
  // Disable caching defensively
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    if (typeof res.removeHeader === 'function') {
      res.removeHeader('ETag');
      res.removeHeader('Last-Modified');
    }
  } catch (_) {}

  // Pagination clamp
  const defaultLimit = 10;
  const maxLimit = 200;
  const pageRaw = parseInt(req.query?.page, 10);
  const limitRaw = parseInt(req.query?.limit, 10);
  const usingExplicitPagination = Number.isFinite(pageRaw) || Number.isFinite(limitRaw);
  const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
  let limit = Number.isFinite(limitRaw) ? limitRaw : defaultLimit;
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const sort = (req.query?.sort && typeof req.query.sort === 'string') ? req.query.sort : '-timestamp';

  // Build filter: start with tenant filter unless bypassed
  let filter = {};
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass);
  const tenant = bypass ? null : (req.tenantId || req.organizationId || (req.auth?.tenantId ? String(req.auth.tenantId) : null));
  if (tenant) {
    filter.$or = [
      { tenant_id: String(tenant) },
      { organization_id: String(tenant) },
      { orgId: String(tenant) },
      { tenantId: String(tenant) },
      { organizationId: String(tenant) },
      { 'tenant.tenant_id': String(tenant) },
    ];
  }

  // Merge client filter except tenant keys
  try {
    if (req.query?.filter) {
      const userFilter = JSON.parse(req.query.filter);
      delete userFilter.tenant_id;
      delete userFilter.tenantId;
      delete userFilter.organization_id;
      delete userFilter.organizationId;
      delete userFilter.orgId;
      if (Object.keys(userFilter).length) {
        filter = Object.keys(filter).length ? { $and: [filter, userFilter] } : userFilter;
      }
    }
  } catch (e) {
    return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
  }

  // Projection to reduce payload
  const projection = {
    _id: 1,
    tenant_id: 1,
    organization_id: 1,
    user_id: 1,
    project_id: 1,
    agent: 1,
    agent_name: 1,
    'metadata.agent': 1,
    'metadata.Agent Name': 1,
    total_cost: 1,
    cost_usd: 1,
    'cost.amount': 1,
    'cost.currency': 1,
    timestamp: 1,
    created_at: 1,
  };

  // Guard when no explicit pagination to avoid huge arrays in memory
  const guardLimit = usingExplicitPagination ? limit : Math.min(50, maxLimit);
  const skip = usingExplicitPagination ? (page - 1) * limit : 0;

  // Use Mongo maxTimeMS if provided by route, and clamp to [200, 2000]
  const maxTimeMS = Math.max(200, Math.min(Number(req.maxTimeMS || 1000), 2000));

  try {
    const query = LLMCost.find(filter, projection)
      .sort(sort)
      .skip(skip)
      .limit(guardLimit)
      .lean({ getters: false, virtuals: false })
      .maxTimeMS(maxTimeMS);

    if (usingExplicitPagination) {
      const [items, total] = await Promise.all([
        query.exec(),
        LLMCost.countDocuments(filter).maxTimeMS(maxTimeMS).exec(),
      ]);
      // Ensure 200 response with envelope
      return res.status(200).json({
        success: true,
        data: items || [],
        meta: { page, limit, total },
      });
    }

    const items = await query.exec();
    // For non-explicit pagination return raw array (consistent with OpenAPI)
    return res.status(200).json(items || []);
  } catch (err) {
    const msg = String(err?.message || err);
    const isMongoTimeout = /operation exceeded time limit|timed out|MaxTimeMS/i.test(msg);
    const status = isMongoTimeout ? 206 : 500;
    return res.status(status).json({
      success: false,
      message: isMongoTimeout ? 'Query exceeded time limit' : 'Internal server error',
      data: [],
      meta: { timedOut: isMongoTimeout, maxTimeMS, page: usingExplicitPagination ? page : undefined, limit: usingExplicitPagination ? limit : undefined },
    });
  }
}

module.exports = { list };
