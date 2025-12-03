'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const { getHierarchy } = require('../controllers/llmCosts.controller');

const router = express.Router();

// Enforce tenant resolution and scoping
router.use(requireTenant, tenantScopeEnforcer());

/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs/hierarchy
 * Aggregates hierarchical costs per user -> projects -> agents with per-date breakdown.
 * Tenant is resolved from x-organization-id header (fallback to ?tenant_id/?organization_id).
 * Client-provided tenant fields are ignored; server enforces tenant.
 */
router.get(
  '/hierarchy',
  asyncHandler(getHierarchy)
);

module.exports = router;