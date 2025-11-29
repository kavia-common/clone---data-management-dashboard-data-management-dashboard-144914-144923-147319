'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');
const controller = require('../controllers/llmCosts.controller');
const { listPerUserFromMainPath } = require('../controllers/llmCostsAggregate.controller.patch');
const { buildCrudController } = require('../controllers/crudFactory');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Lists and CRUD for LLM costs.
 */

// Default CRUD controller (used for non-list routes)
const crud = buildCrudController(LLMCost, '-timestamp');

// Apply auth + tenant enforcement; route-local resolvers will allow demo scoping for GET list
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * Route-local resolver: for GET list, allow organization_id/tenant_id/header when Authorization
 * is not present or tenant not resolved by upstream middleware.
 */
router.use((req, res, next) => {
  try {
    const isList = req.method === 'GET' && (req.path === '/' || req.path === '');
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
    if (isList && !bypass && !req.tenantId) {
      const hdr =
        (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        undefined;
      const q =
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        undefined;
      const resolved = hdr || q || undefined;
      if (resolved) req.tenantId = String(resolved);
    }

    // Diagnostics
    try {
      if (req.tenantScopeDisabled || req.allTenants) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (req.tenantId) {
        const t = String(req.tenantId);
        res.set('X-Applied-Tenant', t);
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      }
    } catch (_) {}
  } catch (_) {}
  next();
});

/**
 * GET /api/llm-costs
 * PUBLIC_INTERFACE
 * If pagination and organization filters are present, return the per-user listing for fast tabular data.
 * Otherwise, return the default document list.
 */
router.get('/', asyncHandler((req, res, next) => {
  const hasPaging = typeof req.query.page !== 'undefined' || typeof req.query.limit !== 'undefined';
  const hasOrg =
    typeof req.query.organization_id !== 'undefined' ||
    typeof req.query.tenant_id !== 'undefined' ||
    typeof req.headers['x-organization-id'] !== 'undefined';
  if (hasPaging && hasOrg) {
    return listPerUserFromMainPath(req, res, next);
  }
  return controller.list(req, res, next);
}));

// Keep other CRUD endpoints
router.get('/:id', asyncHandler(crud.getById));
router.post('/', asyncHandler(crud.create));
router.put('/:id', asyncHandler(crud.update));
router.delete('/:id', asyncHandler(crud.remove));

module.exports = router;
