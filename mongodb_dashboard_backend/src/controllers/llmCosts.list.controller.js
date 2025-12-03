'use strict';

const mongoose = require('mongoose');
const LlmCosts = require('../models/llmCosts.model'); // model exists in models directory
const { success, handleError } = require('../utils/http');

// PUBLIC_INTERFACE
async function list(req, res) {
  /**
   * PUBLIC_INTERFACE
   * Handler: GET /api/llm-costs
   * Returns list of LLM cost documents with strict pagination clamp and lean projection to minimize memory.
   * - Enforces tenant scoping using req.tenantId/organizationId if present. Ignores tenant fields from client filter.
   * - Default limit=10, max=100. If page/limit not provided, returns raw array with implicit limit 50 to guard memory.
   */
  try {
    // Parse and sanitize filter
    let clientFilter = {};
    if (req.query && req.query.filter) {
      try {
        clientFilter = JSON.parse(req.query.filter);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }
    delete clientFilter.tenant_id;
    delete clientFilter.tenantId;
    delete clientFilter.organization_id;
    delete clientFilter.organizationId;
    delete clientFilter.orgId;

    // Resolve tenant
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass);
    const resolvedTenant = bypass ? undefined : (req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined));
    const tenantFilter =
      resolvedTenant
        ? {
            $or: [
              { tenant_id: String(resolvedTenant) },
              { organization_id: String(resolvedTenant) },
              { orgId: String(resolvedTenant) },
              { tenantId: String(resolvedTenant) },
              { organizationId: String(resolvedTenant) },
              { 'tenant.tenant_id': String(resolvedTenant) },
            ],
          }
        : null;

    const filter = tenantFilter
      ? (Object.keys(clientFilter).length ? { $and: [clientFilter, tenantFilter] } : tenantFilter)
      : clientFilter;

    // Pagination clamp
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const providedLimit = parseInt(req.query.limit, 10);
    const defaultLimit = 10;
    const maxLimit = 100;
    const limit = Math.max(1, Math.min(maxLimit, Number.isFinite(providedLimit) ? providedLimit : defaultLimit));
    const sort = (req.query.sort && String(req.query.sort)) || '-timestamp';

    // Projection: return only commonly used fields
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

    // If no explicit pagination was provided, we still guard with a modest cap to avoid huge arrays in memory.
    const usingExplicitPagination = Number.isFinite(providedLimit) || Number.isFinite(parseInt(req.query.page, 10));
    const guardLimit = usingExplicitPagination ? limit : Math.min(50, maxLimit);
    const skip = (page - 1) * guardLimit;

    // Use lean() to avoid hydration, and avoid allowDiskUse on find
    const query = LlmCosts.find(filter, projection).sort(sort).skip(skip).limit(guardLimit).lean({ getters: false, virtuals: false });
    const items = await query.exec();

    try {
      if (resolvedTenant) {
        res.set('X-Applied-Tenant', String(resolvedTenant));
        res.set('x-applied-tenant-filter', JSON.stringify(filter));
      }
    } catch {}

    if (usingExplicitPagination) {
      // Compute total count with the same filter, but avoid blocking: in dev this is fine for small tenants
      const total = await LlmCosts.countDocuments(filter).exec();
      return success(res, {
        success: true,
        data: items,
        meta: { page, limit: guardLimit, total },
      });
    }
    return success(res, items);
  } catch (err) {
    return handleError(res, err);
  }
}

module.exports = { list };
