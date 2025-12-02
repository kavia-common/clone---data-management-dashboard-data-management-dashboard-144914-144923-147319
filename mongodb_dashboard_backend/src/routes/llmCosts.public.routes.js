const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const { getLlmCostsLastDiagnostics } = require('../controllers/llmCosts.diagnostics.controller');
const { listLlmCosts } = require('../controllers/llmCosts.list.controller');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort retained for deprecated alias only
const controller = buildCrudController(LLMCost, '-timestamp');

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/diagnostics/last
 * Diagnostics should be accessible even if tenant middleware blocks list; it does not touch DB.
 */
router.get('/diagnostics/last', asyncHandler(getLlmCostsLastDiagnostics));

// Enforce tenant isolation for primary routes on this router
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Specialized handler with strict guards (date window, limit, projections, diagnostics and timing headers).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Drop client-provided generic filter to avoid unindexed queries
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
      delete req.query.filter;
    }
    // Allow from/to if provided; the specialized controller will clamp/validate the window
    return listLlmCosts(req, res);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Deprecated alias: forwards to generic list for backward compatibility (tenant-scoped).
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    return controller.list(req, res);
  })
);

module.exports = router;
