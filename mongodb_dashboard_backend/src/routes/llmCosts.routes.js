'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement.
 */
const router = express.Router();
/**
 * Use safe default sort on indexed field 'timestamp' in descending order.
 * Sorting by '-timestamp' benefits from index { tenant_id:1, timestamp:-1 } on the model.
 */
const controller = buildCrudController(LLMCost, '-timestamp'); // default indexed sort

/**
 * Resolve tenantId from JWT/header/query and enforce on queries.
 * Apply verifyAuth explicitly as a safeguard in case the router is mounted without it.
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * Expose applied tenant for quick debugging on responses at this router scope
 * Adds both X-Applied-Tenant and x-applied-organization-id for preview verification.
 */
router.use(async (req, res, next) => {
  try {
    if (req.tenantId) {
      res.set('X-Applied-Tenant', String(req.tenantId));
      res.set('x-applied-organization-id', String(req.tenantId));
      const tenant = String(req.tenantId);
      const orgFilter = {
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      };
      res.set('X-Applied-Filter', JSON.stringify(orgFilter));
      try {
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm_costs');
      } catch (_) {}
    }
  } catch (_) {}
  next();
});

/**
 * GET /api/llm-costs
 * The generic controller will:
 *  - Parse and validate pagination/sort
 *  - Parse filter (strip any client tenant hints)
 *  - Merge filter with normalized tenant OR over aliases
 *  - Enforce JWT/header tenant and deny cross-tenant access (403)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Allow custom filter but defensively strip any tenant keys to prevent bypass
    const raw = req.query.filter;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          delete parsed.tenant_id;
          delete parsed.tenantId;
          delete parsed.organization_id;
          delete parsed.organizationId;
          delete parsed.orgId;
          req.query.filter = JSON.stringify(parsed);
        }
      } catch {
        req.query.filter = '{}';
      }
    }
    return controller.list(req, res);
  })
);

// Standard CRUD endpoints use the tenant-aware controller
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
