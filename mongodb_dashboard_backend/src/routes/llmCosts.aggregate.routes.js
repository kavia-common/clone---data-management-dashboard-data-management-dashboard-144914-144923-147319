const express = require('express');
const { getAggregatedCosts } = require('../controllers/llmCostsAggregate.controller');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');

const router = express.Router();

// Enforce tenant scoping for aggregate endpoint
router.use(requireTenant, tenantScopeEnforcer());

/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: Aggregated LLM cost data (users and projects)
 *     description: >
 *       Returns arrays of users and projects with cost fields populated from their respective collections.
 *       Defaults to 0 for missing user_cost/project_cost fields.
 *     tags: [LLMCosts]
 *     responses:
 *       200:
 *         description: Aggregated users and projects with cost fields
 *       500:
 *         description: Internal server error
 */
// PUBLIC_INTERFACE
router.get('/', getAggregatedCosts);

module.exports = router;
