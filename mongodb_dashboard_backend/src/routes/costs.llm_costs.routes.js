'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { getLlmCostsAggregated } = require('../controllers/costs.llm_costs.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Aggregated LLM costs view.
 * Query: organization_id (optional), page (default 1), limit (default 10, max 100).
 * Returns rows with: organization_id, organization_name, user_id, type, user_cost, projects,
 * enriched with organization_cost and users.
 * Diagnostics headers:
 *  - X-LLM-COSTS-Collection
 *  - X-LLM-COSTS-MatchedPreGroup
 *  - X-LLM-COSTS-PostGroupCount
 *  - X-LLM-COSTS-Reason (when rows empty)
 */
router.get('/', asyncHandler(getLlmCostsAggregated));

module.exports = router;
