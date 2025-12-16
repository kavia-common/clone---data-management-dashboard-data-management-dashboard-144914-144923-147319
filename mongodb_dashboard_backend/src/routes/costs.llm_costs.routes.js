'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { getLlmCostsAggregated } = require('../controllers/costs.llm_costs.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm_costs
 * Aggregated view from llm_costs collection filtered by organization_id.
 * Returns fields: organization_id, organization_name, organization_cost, users (count of users with projects),
 * user_id, type, user_cost, projects (count of projects per user).
 * Supports pagination via ?page=&limit=. Without pagination params, returns a raw array.
 */
router.get('/', asyncHandler(getLlmCostsAggregated));

module.exports = router;
