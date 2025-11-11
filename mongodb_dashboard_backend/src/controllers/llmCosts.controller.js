'use strict';

const { success, handleError } = require('../utils/http');
const { aggregateHierarchy, ensureLlmCostsIndexes } = require('../services/llmCostsHierarchy.service');

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

    const resolvedTenant = req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined);
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
