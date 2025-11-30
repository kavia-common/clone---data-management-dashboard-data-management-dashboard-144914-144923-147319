'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { verifyAuth, requireTenant, tenantScopeEnforcer } = require('../middleware');
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

// Enforce auth+tenant for write and ID routes only; allow list without strict tenant enforcement
router.use((req, res, next) => {
  const isList = req.method === 'GET' && (req.path === '/' || req.path === '');
  if (!isList) {
    return verifyAuth(req, res, (err) => {
      if (err) return next(err);
      requireTenant(req, res, (err2) => {
        if (err2) return next(err2);
        return tenantScopeEnforcer()(req, res, next);
      });
    });
  }
  return next();
});

// Route-local resolver for optional tenant filter on list endpoint
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
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Returns a ListEnvelope:
 * { success: true, data: [...], meta: { page, limit, total } }
 * - Optional tenant filter (?organization_id or ?tenant_id). When omitted, returns all documents.
 * - Safe defaults: limit=20 (default flow capped at 50), absolute cap 200 when explicitly requested.
 * - Stable sort and maxTimeMS to avoid timeouts.
 * - No unwinds or restrictive filters that could drop rows.
 */
router.get('/', asyncHandler(controller.listLLMCosts));

// Keep other CRUD endpoints (require auth/tenant enforced above)
router.get('/:id', asyncHandler(crud.getById));
router.post('/', asyncHandler(crud.create));
router.put('/:id', asyncHandler(crud.update));
router.delete('/:id', asyncHandler(crud.remove));

module.exports = router;
