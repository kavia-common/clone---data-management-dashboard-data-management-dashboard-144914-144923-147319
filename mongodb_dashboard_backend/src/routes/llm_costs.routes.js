'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { getLlmCostsAggregated } = require('../controllers/costs.llm_costs.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Aggregated LLM costs view with nested users/projects handling.
 * Query: organization_id (optional), page>=1 (default 1), limit>0 (default 10, max 100).
 * Response rows: organization_id, organization_name, organization_cost, users, projects, cost.
 * Adds diagnostics headers:
 *  - X-LLM-COSTS-Collection=llm_costs
 *  - X-LLM-COSTS-MatchedPreGroup
 *  - X-LLM-COSTS-PostGroupCount
 */
router.get('/', asyncHandler(getLlmCostsAggregated));

module.exports = router;
