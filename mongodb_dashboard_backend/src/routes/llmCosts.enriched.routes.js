'use strict';

const express = require('express');
const router = express.Router();

const { listEnrichedCosts } = require('../controllers/costs.enriched.controller');
const { resolveTenantScope } = require('../middleware/tenantScope');
// Use the existing asyncHandler utility used across the project
const { asyncHandler } = require('../utils/http');

/**
 * GET /api/costs
 * Summary: List costs enriched with user_name
 * Description: Joins llm_costs.user_id to users._id using $lookup and returns user_name along with existing fields.
 * Query: page, limit, sort, filter (JSON; whitelisted fields). Tenant scoping enforced.
 */
router.get('/', resolveTenantScope, asyncHandler(listEnrichedCosts));

module.exports = router;
