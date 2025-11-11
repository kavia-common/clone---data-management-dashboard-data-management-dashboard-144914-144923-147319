'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const { getHierarchy } = require('../controllers/llmCosts.controller');

const router = express.Router();

// Enforce tenant resolution and scoping with JWT precedence
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/hierarchy
 * Aggregates hierarchical costs per user -> projects -> agents with per-date breakdown.
 * Tenant is resolved from JWT when Authorization is present; otherwise x-organization-id header is required.
 * Client-provided tenant fields are ignored; server enforces tenant.
 */
router.get(
  '/hierarchy',
  asyncHandler(getHierarchy)
);

module.exports = router;
