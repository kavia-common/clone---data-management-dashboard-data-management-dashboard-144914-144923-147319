const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');
const { listLlmCosts } = require('../controllers/llmCosts.fallback.controller');

const router = express.Router();
// Default sort retained; list is still tenant-scoped via middleware/controller
const controller = buildCrudController(LLMCost, '-timestamp');

// Enforce tenant isolation for all requests on this router
router.use(requireTenant, tenantScopeEnforcer());

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
    // Surface effective tenant headers early for diagnostics
    const jwtTenant = req?.auth?.tenantId;
    const headerTenant = req.headers['x-organization-id'] || req.query.organization_id || req.query.tenant_id;
    const resolvedTenant = jwtTenant ? String(jwtTenant) : (headerTenant ? String(headerTenant) : null);
    if (resolvedTenant) res.set('x-effective-tenant', resolvedTenant);

    // Clear client-provided tenant filter keys
    const rawFilter = req.query.filter;
    try {
      if (rawFilter) {
        const parsed = typeof rawFilter === 'string' ? JSON.parse(rawFilter) : rawFilter;
        delete parsed?.tenant_id;
        delete parsed?.tenantId;
        delete parsed?.organization_id;
        req.query.filter = JSON.stringify(parsed || {});
      }
    } catch {
      req.query.filter = '{}';
    }

    // Add diagnostics: resolve effective collection name from env and add header
    const envCollection = (process.env.LLMCOSTS_COLLECTION_NAME || process.env.LLM_COSTS_COLLECTION || '').trim() || 'llm_costs';
    res.set('X-LLM-COSTS-Collection', envCollection);

    // Use the richer fallback controller which handles model-first and native-driver fallback with diagnostics
    return listLlmCosts(req, res);
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