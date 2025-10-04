const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
const controller = buildCrudController(LLMCost, '-timestamp');

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Returns LLM cost documents with optional filters:
 * - projectId: string (maps to project_id)
 * - from, to: ISO date-time strings (applied to timestamp)
 * Supports optional pagination via page/limit and sort.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    const { projectId, from, to } = req.query;

    if (projectId) filter.project_id = String(projectId);

    if (from || to) {
      const range = {};
      if (from) {
        const d = new Date(from);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid from date' });
        }
        range.$gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ success: false, message: 'Invalid to date' });
        }
        range.$lte = d;
      }
      filter.timestamp = range;
    }

    // Merge with any JSON filter provided
    const originalFilter = req.query.filter;
    try {
      const merged =
        originalFilter && typeof originalFilter === 'string'
          ? { ...JSON.parse(originalFilter), ...filter }
          : { ...(originalFilter || {}), ...filter };
      req.query.filter = JSON.stringify(merged);
    } catch (_e) {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    return controller.list(req, res);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Reuses same handler with projectId pre-applied from path param.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    req.query.projectId = req.params.projectId;
    // Reuse the root GET logic by rewriting to '/'
    return router.handle({ ...req, url: '/', method: 'GET' }, res);
  })
);

module.exports = router;
