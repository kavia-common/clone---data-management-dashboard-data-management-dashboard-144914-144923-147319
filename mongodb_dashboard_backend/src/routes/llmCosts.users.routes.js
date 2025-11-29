'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const { listPerUserLLMCosts } = require('../controllers/llmCosts.users.controller');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Users Router
 * Adds a high-performance per-user listing endpoint to avoid timeouts.
 *
 * Notes:
 * - Keeps existing /api/llm-costs endpoints intact; this adds /api/llm-costs/users.
 * - Enforces tenant scoping; Super Admin (T0000 or x-all-tenants=true) can bypass scoping.
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * GET /api/llm-costs/users
 * Summary: List LLM costs one row per user with pagination and organization filter
 * Description:
 *   Returns per-user rows by unwinding users[] under llm-costs collection. Fields:
 *   { id, organization_id, user_id, type, user_cost, project_count, organization_cost }.
 *   Supports ?page, ?limit, ?organization_id (alias tenant_id), and sort (default createdAt desc).
 *   Stable sort and projections minimize payload. Aggregation uses allowDiskUse(true).
 */
router.get('/users', asyncHandler(listPerUserLLMCosts));

module.exports = router;
