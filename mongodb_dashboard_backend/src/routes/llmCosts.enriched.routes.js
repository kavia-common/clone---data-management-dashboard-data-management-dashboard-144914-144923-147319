'use strict';

const express = require('express');
const router = express.Router();

const { listEnrichedCosts } = require('../controllers/costs.enriched.controller');
const { resolveTenantScope } = require('../middleware/tenantScope');
// Use the existing asyncHandler utility used across the project
const { asyncHandler } = require('../utils/http');

/**
 * GET /api/costs
 * Returns LLM costs enriched with user_name joined from users.
 * - Envelope response with pagination and meta.
 * - Tenant scoping enforced using existing conventions.
 */
router.get('/', resolveTenantScope, asyncHandler(listEnrichedCosts));

module.exports = router;
