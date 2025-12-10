const express = require('express');
const { asyncHandler } = require('../utils/http');
const { listLlmCosts } = require('../controllers/llmCosts.fallback.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Public-friendly list with tenant scoping resolved from:
 *  - Authorization JWT (preferred; cannot be overridden)
 *  - x-organization-id header
 *  - query ?tenant_id or ?organization_id
 * No hidden filters (e.g., model/project/user) are applied unless explicitly provided via ?filter=.
 * When no date range is provided, a default MAX_DAYS_WINDOW (90) ending at now is used.
 * Always returns { success, data, meta } and emits x-llm-* diagnostics headers in dev.
 */
router.get('/', asyncHandler(listLlmCosts));

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Deprecated alias: forwards to list endpoint. Does not imply project filter.
 */
router.get('/projects/:projectId/llm-costs', asyncHandler(listLlmCosts));

module.exports = router;