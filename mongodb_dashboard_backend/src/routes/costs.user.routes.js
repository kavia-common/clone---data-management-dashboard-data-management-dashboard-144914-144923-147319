'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const { getUserTotalCost } = require('../controllers/costs.user.controller');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/costs/user/total
 * Summary: Return total LLM costs for a specific user (user_id) within the resolved tenant.
 * Description:
 *   Computes totals and breakdowns (by agent and type) for a single user by matching user_id as a string.
 *   Tenant scoping is enforced by upstream middleware (requireTenant + tenantScopeEnforcer).
 * Query:
 *   - user_id: string (required)
 *   - page, limit, sort: optional (forwarded for parity; not used for aggregation itself)
 * Responses:
 *   200: { success, data: { userId, total_cost, user_cost, currency, by_agent[], by_type[] }, meta: { tenant_id, page, limit, sort } }
 *   400: Missing user_id
 */
router.use(requireTenant, tenantScopeEnforcer());
router.get('/user/total', asyncHandler(getUserTotalCost));

module.exports = router;
