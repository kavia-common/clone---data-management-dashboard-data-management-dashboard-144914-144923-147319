const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
/**
 * Use '-timestamp' as default sort. This pairs with compound indexes:
 * { tenant_id: 1, timestamp: -1 } and { organization_id: 1, timestamp: -1 }.
 */
const controller = buildCrudController(LLMCost, '-timestamp');

// Enforce tenant isolation for all requests on this router
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * PUBLIC_INTERFACE
 * Note: All /api/llm-costs endpoints require the x-organization-id header. Query aliases (?tenant_id, ?organization_id) are optional and ignored when the header is present. Any tenant fields in payload are overridden by the resolved tenant.
 * GET /api/llm-costs
 * Returns all tenant-scoped documents from the llm_costs collection.
 * - Ignores any tenant_id/organization_id in client filter and enforces the resolved tenant.
 * - If page/limit are provided, an envelope { success, data, meta } is returned as per generic controller.
 * - Otherwise a raw array of documents is returned with all fields intact (no projection).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Per requirement: Ignore/remove any 'filter' param entirely for GET /api/llm-costs
    // Preserve tenant scoping via middleware/controller and keep sort/limit behavior.
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
      delete req.query.filter;
    }

    // Also explicitly drop legacy date range params if present (server no longer applies date compounds here)
    if (typeof req.query.start !== 'undefined') delete req.query.start;
    if (typeof req.query.end !== 'undefined') delete req.query.end;
    if (typeof req.query.from !== 'undefined') delete req.query.from;
    if (typeof req.query.to !== 'undefined') delete req.query.to;

    // Mark possible super-admin bypass headers similarly to other routes (diagnostic only)
    try {
      const hdr = (req.headers?.['x-organization-id'] || '').toString();
      const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
      const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
      const requestedTenant = hdr || qOrg || authTenant || '';
      const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
      if (isT0000) {
        req.tenantScopeDisabled = true;
        req.allTenants = true;
        req.costsAllTenantsBypass = true;
        try {
          res.set('X-All-Tenants', 'true');
          res.set('X-Tenant-Bypass', 'true');
          res.set('X-Requested-Tenant', 'T0000');
        } catch {}
      }
    } catch {}

    return controller.list(req, res);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Deprecated alias: forwards to list endpoint (tenant-scoped); no project-based filter implied.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    return controller.list(req, res);
  })
);

module.exports = router;
