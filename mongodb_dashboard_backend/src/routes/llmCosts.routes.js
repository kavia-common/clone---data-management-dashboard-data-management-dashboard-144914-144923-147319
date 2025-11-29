'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');
const controller = require('../controllers/llmCosts.controller');
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
 * Returns a paginated list of items with:
 *  - id: MongoDB _id
 *  - user_cost: first non-null users[].user_cost or 0
 *  - project_count: size of project array
 * Supports ?organization_id filter, ?page, ?limit, and ?sort (defaults to createdAt/timestamp desc).
 */
router.get('/', asyncHandler(controller.listLLMCosts));

// Keep other CRUD endpoints
router.get('/:id', asyncHandler(crud.getById));
router.post('/', asyncHandler(crud.create));
router.put('/:id', asyncHandler(crud.update));
router.delete('/:id', asyncHandler(crud.remove));

module.exports = router;
