'use strict';

const express = require('express');
const router = express.Router();

const { listEnrichedCosts } = require('../controllers/costs.enriched.controller');
const { resolveTenantScope } = require('../middleware/tenantScope');

/**
 * Local async wrapper to forward errors to Express error handler.
 * This avoids relying on a missing withAsync export.
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/costs
 * Returns LLM costs enriched with user_name joined from users.
 * - Envelope response with pagination and meta.
 * - Tenant scoping enforced using existing conventions.
 */
router.get('/', resolveTenantScope, asyncHandler(async (req, res, next) => {
  await listEnrichedCosts(req, res, next);
  // minimal verification log to confirm 200 path is exercised
  // eslint-disable-next-line no-console
  console.log('[llmCosts.enriched] responded for tenant:', req?.tenantScope?.tenantId || 'unknown');
}));

module.exports = router;
