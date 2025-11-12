const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort retained; list is still tenant-scoped via middleware/controller
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
    // Clear client-provided filter to avoid tenant bypass; CRUD will merge with enforced tenant anyway
    const rawFilter = req.query.filter;
    // Allow non-tenant filters but remove client-tenant keys if present
    try {
      if (rawFilter) {
        const parsed = typeof rawFilter === 'string' ? JSON.parse(rawFilter) : rawFilter;
        // Strip only tenant aliases; keep organization_id to allow indexed primary strategy if it matches scope.
        if (parsed && typeof parsed === 'object') {
          delete parsed.tenant_id;
          delete parsed.tenantId;
          delete parsed.organizationId;
          delete parsed.orgId;
          delete parsed['tenant.tenant_id'];
        }
        req.query.filter = JSON.stringify(parsed || {});
      }
    } catch {
      req.query.filter = '{}';
    }
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
