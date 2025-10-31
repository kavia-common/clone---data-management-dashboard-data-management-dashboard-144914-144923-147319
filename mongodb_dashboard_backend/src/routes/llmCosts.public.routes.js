const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort retained, but will not affect "list all" unless client passes pagination/sort explicitly
const controller = buildCrudController(LLMCost, '-timestamp');

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Returns ALL documents from the llm_costs collection without requiring or applying any project or date filters.
 * - Does NOT require projectId and does NOT filter by it.
 * - If page/limit are provided, an envelope { success, data, meta } is returned as per generic controller.
 * - Otherwise a raw array of documents is returned with all fields intact (no projection).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Ensure we are listing everything: clear any filter coming from client
    req.query.filter = '{}';
    return controller.list(req, res);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Deprecated alias: forwards to list-all endpoint without filtering by project.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    // Forward to root GET which lists all; no project-based filtering
    return router.handle({ ...req, url: '/', method: 'GET' }, res);
  })
);

module.exports = router;
