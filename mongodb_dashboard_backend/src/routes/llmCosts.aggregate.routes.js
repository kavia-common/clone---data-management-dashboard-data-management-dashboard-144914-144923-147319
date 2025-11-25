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

// Route-local super admin (T0000) bypass detector for analytics aggregate
router.use((req, res, next) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = hdr || qOrg || authTenant || '';
    const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.costsAggregateAllTenantsBypass = true;
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
    }
    console.log('[llmCosts.aggregate.routes] bypass check', { requestedTenant, isT0000, bypassApplied: !!isT0000 });
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
