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
      const tenant = String(req.tenantId);
      // Minimal diagnostics only
      res.set('X-Applied-Tenant', tenant);
      res.set('x-applied-organization-id', tenant);
      try {
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm_costs');
      } catch (_) {}
    } else {
      res.set('X-Applied-Tenant', 'none');
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
router.get('/_debug/applied-tenant', asyncHandler(async (req, res) => {
  return res.status(200).json({
    tenant: req.tenantId ? String(req.tenantId) : null,
    model: LLMCost.collection?.name || 'llm_costs',
  });
}));

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Normalize client filter and strip any risky nested tenant hints; let controller enforce tenant scope.
    const raw = req.query.filter;
    if (raw) {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object') {
          // Drop any nested alias that could bypass scoping
          if (Object.prototype.hasOwnProperty.call(parsed, 'tenant.tenant_id')) {
            delete parsed['tenant.tenant_id'];
          }
          req.query.filter = JSON.stringify(parsed);
        }
      } catch {
        req.query.filter = '{}';
      }
    }

    // Lightweight debug header to confirm requested query aliases vs resolved tenant
    try {
      const clientOrg =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        null;
      res.set('X-Client-Requested-Tenant', clientOrg || 'none');
      res.set('X-Resolved-Tenant', req.tenantId ? String(req.tenantId) : 'none');
    } catch (_) {}

    // Temporary console for deep-verification (non-production only)
    try {
      if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
        // eslint-disable-next-line no-console
        console.debug('[llm-costs] GET /api/llm-costs tenant=', String(req.tenantId || ''), 'filterRaw=', req.query.filter || '{}');
      }
    } catch (_) {}
    return controller.list(req, res);
  })
);

// Standard CRUD endpoints use the tenant-aware controller
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
