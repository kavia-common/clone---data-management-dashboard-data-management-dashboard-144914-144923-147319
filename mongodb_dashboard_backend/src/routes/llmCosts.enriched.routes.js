'use strict';

const express = require('express');
const router = express.Router();

const { listEnrichedCosts } = require('../controllers/costs.enriched.controller');
const { resolveTenantScope } = require('../middleware/tenantScope');
const { withAsync } = require('../middleware/standardHandlers');

/**
 * GET /api/costs
 * Returns LLM costs enriched with user_name joined from users.
 * - Envelope response with pagination and meta.
 * - Tenant scoping enforced using existing conventions.
 */
router.get('/', resolveTenantScope, withAsync(listEnrichedCosts));

module.exports = router;
