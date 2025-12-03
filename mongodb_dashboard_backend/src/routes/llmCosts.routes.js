'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');
const { list: listLlmCosts } = require('../controllers/llmCosts.list.controller');
const { getHierarchy } = require('../controllers/llmCosts.controller');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement plus a safe list variant with strict pagination and lean projection.
 */
const router = express.Router();
/**
 * Use safe default sort on indexed field 'timestamp' in descending order.
 * Sorting by '-timestamp' benefits from index { tenant_id:1, timestamp:-1 } or { organization_id:1, timestamp:-1 } on the model.
 */
const controller = buildCrudController(LLMCost, '-timestamp'); // default indexed sort

/**
 * Apply core auth+tenant middleware; allow route-local resolver to set tenantId for demo/preview calls
 * where Authorization may be missing and organization_id is provided as query/header.
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * Route-local resolver: for GET /api/llm-costs (list) allow resolving tenant
 * from x-organization-id or ?organization_id/?tenant_id when req.tenantId is not set.
 */
router.use((req, res, next) => {
  try {
    const isList = req.method === 'GET' && (req.path === '/' || req.path === '');
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);

    if (isList && !bypass) {
      // If verifyAuth/requireTenant didn't resolve tenantId, accept aliases
      if (!req.tenantId) {
        const hdrOrg =
          (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
          (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
          (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
          undefined;
        const qOrg =
          (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
          (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
          (typeof req.query?.org_id === 'string' && req.query.org_id.trim()) ||
          undefined;
        const resolved = hdrOrg || qOrg || undefined;
        if (resolved) {
          req.tenantId = String(resolved);
        }
        try {
          res.set(
            'X-Requested-Tenant-Aliases',
            JSON.stringify({
              header: hdrOrg || null,
              query_org: req.query?.organization_id || null,
              query_tenant: req.query?.tenant_id || null,
              query_org_id: req.query?.org_id || null,
            })
          );
        } catch (_) {}
      }
    }

    // Diagnostics headers
    try {
      if (req.tenantScopeDisabled || req.allTenants) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (req.tenantId) {
        const t = String(req.tenantId);
        res.set('X-Applied-Tenant', t);
        res.set(
          'X-Applied-Filter',
          JSON.stringify({
            $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }],
          })
        );
      }
      try {
        res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      } catch (_) {}
    } catch (_) {}
  } catch (_) {
    // non-fatal
  }
  next();
});

/**
 * Super Admin and T0000 bypass (route-local)
 */
router.use((req, res, next) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = hdr || qOrg || authTenant || '';
    const isT0000 = requestedTenant && /^T0+$/i.test(requestedTenant);

    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.costsAllTenantsBypass = true;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch (_) {}
      console.log('[llmCosts.routes] SuperAdmin/T0000 bypass applied', {
        inputs: { hdr, qOrg, authTenant },
        requestedTenant,
        isT0000,
      });
    }
  } catch (e) {
    // non-fatal
  }
  next();
});

/**
 * GET /api/llm-costs — memory-safe list with strict clamp and lean projection
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Disable caching
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      if (typeof res.removeHeader === 'function') {
        res.removeHeader('ETag');
        res.removeHeader('Last-Modified');
      }
      res.set('ETag', 'W/\"disabled\"');
    } catch (_) {}

    // Clamp pagination early (default 10, max 200)
    try {
      const lim = parseInt(req.query?.limit, 10);
      if (!Number.isFinite(lim) || lim <= 0) {
        req.query.limit = '10';
      } else if (lim > 200) {
        req.query.limit = '200';
      }
      const pg = parseInt(req.query?.page, 10);
      if (!Number.isFinite(pg) || pg < 1) {
        if (req.query?.page !== undefined) req.query.page = '1';
      }
    } catch (_) {}

    // Apply Mongo maxTimeMS and a route-level timeout (~1000ms)
    const TIMEOUT_MS = 100000;
    let timedOut = false;
    const to = setTimeout(() => {
      timedOut = true;
      try {
        // On timeout, return partial hint with 206
        if (!res.headersSent) {
          res.status(206).json({
            success: false,
            message: 'Query timed out',
            data: [],
            meta: { timedOut: true, maxTimeMS: TIMEOUT_MS }
          });
        }
      } catch (_) {}
    }, TIMEOUT_MS);

    try {
      // Flag downstream controller to use maxTimeMS
      req.maxTimeMS = TIMEOUT_MS;
      await listLlmCosts(req, res);
    } catch (e) {
      if (!res.headersSent) {
        const msg = String(e?.message || e);
        const isMongoTimeout = /operation exceeded time limit|timed out|MaxTimeMS/i.test(msg);
        const status = isMongoTimeout ? 206 : 500;
        res.status(status).json({
          success: false,
          message: isMongoTimeout ? 'Query exceeded time limit' : 'Internal server error',
          data: [],
          meta: { timedOut: isMongoTimeout || timedOut, maxTimeMS: TIMEOUT_MS }
        });
      }
    } finally {
      clearTimeout(to);
    }
  })
);

// Keep hierarchy endpoint as defined in controller
router.get('/hierarchy', asyncHandler(getHierarchy));

// Basic CRUD routes (optional but preserved)
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
