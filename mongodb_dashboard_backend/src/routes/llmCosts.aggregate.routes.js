'use strict';

const express = require('express');
const { getAggregatedCosts } = require('../controllers/llmCostsAggregate.controller');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');

const router = express.Router();

/**
 * Enforce tenant scoping for aggregate endpoint.
 * Aggregations should always begin with a $match on tenant_id (middleware helpers provide req.tenantId),
 * then perform $group/$sort. For large pipelines ensure allowDiskUse(true) is enabled.
 */
router.use(requireTenant, tenantScopeEnforcer());

 // Route-local super admin (T0000) bypass detector for analytics aggregate + normalization
router.use((req, res, next) => {
  try {
    const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';
    const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const hdr =
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers?.['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      '';
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const normalized = hdr || qOrg || qTenant || authTenant || '';
    const isT0000 = normalized === 'T0000';
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.costsAggregateAllTenantsBypass = true;
      try { 
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch (_) {}
    } else if (normalized) {
      req.organizationId = normalized;
      req.tenantId = normalized;
      try { res.set('X-Applied-Tenant', String(normalized)); } catch(_) {}
    }
    console.log('[llmCosts.aggregate.routes] tenant normalization', { organization_id: qOrg || null, tenant_id: qTenant || null, normalizedTenant: normalized || null, bypassApplied: isT0000 });
  } catch (_) {}
  next();
});

/**
 * @swagger
 * /api/analytics/llm-cost-by-agent:
 *   get:
 *     summary: LLM cost distribution by agent
 *     description: |
 *       Aggregates the llm_cost/llm_costs collection by Agents[0]."Agent Name" (or equivalent field), summing numeric values parsed from cost fields.
 *       Returns an array sorted in descending order of total_cost.
 *       Tenant scoping is resolved from the required header `x-organization-id`.
 *       Optional query aliases (?tenant_id or ?organization_id) are ignored when the header is present.
 *     tags: [Analytics]
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         required: true
 *         schema:
 *           type: string
 *         description: Required organization (tenant) id; takes precedence over query (?tenant_id or ?organization_id).
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Optional alias for tenant; ignored if header is provided.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Optional alias for tenant; ignored if header is provided.
 *     responses:
 *       200:
 *         description: Aggregated cost by agent (descending)
 *       500:
 *         description: Internal server error
 */
// PUBLIC_INTERFACE
router.get('/', getAggregatedCosts);

module.exports = router;
