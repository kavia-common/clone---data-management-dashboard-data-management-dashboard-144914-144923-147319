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
 * Apply core auth+tenant middleware but allow route-local resolver to set tenantId for demo/preview calls
 * where Authorization may be missing and organization_id is provided as query/header.
 */
/**
 * Important: Do not force early 400 on missing JWT/tenant for list endpoint.
 * We allow verifyAuth to run (demo token in dev), and requireTenant to resolve tenant from header/query.
 * If tenant is still not present, the controller will return a clear 400 with diagnostics.
 * This mirrors /api/users behavior and aligns with OpenAPI docs which allow x-organization-id or aliases
 * when Authorization is not present (demo/testing scenarios).
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * Route-local resolver: for GET /api/llm-costs (list) allow resolving tenant
 * from x-organization-id or ?organization_id/?tenant_id when req.tenantId is not set.
 * Mirrors behavior of /api/users.
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
          undefined;
        const resolved = hdrOrg || qOrg || undefined;
        if (resolved) {
          req.tenantId = String(resolved);
          try { res.set('X-Tenant-Resolved-From', hdrOrg ? 'header' : 'query'); } catch (_) {}
        }
      }
    }

    // Diagnostics headers similar to users route
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
      try { res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs'); } catch (_) {}
    } catch (_) {}
  } catch (_) {
    // non-fatal
  }
  next();
});

/**
 * Super Admin and T0000 bypass (route-local, consistent with users route)
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
    } else {
      console.log('[llmCosts.routes] bypass not applied', {
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
 * Diagnostics header injector
 */
router.use((req, res, next) => {
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
    try { res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs'); } catch (_) {}
  } catch (_) {}
  next();
});

/**
 * @swagger
 * tags:
 *   name: LLMCosts
 *   description: LLM usage cost records endpoints
 */

/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List LLM cost records
 *     description: |
 *       Returns a list of LLM cost documents. Supports optional JSON filter, sorting and pagination.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned.
 *       Tenant scoping: When Authorization is present, JWT tenant is enforced and overrides header/query. If a different organization_id/tenant_id is provided than the JWT tenant, the request is rejected with 403.
 *       In demo mode without JWT, x-organization-id header or query aliases (?tenant_id/organization_id) can be used to set scope.
 *       The server ignores any tenant fields in the filter and injects the resolved tenant internally.
 *       Sorting does not require a timestamp field; it defaults safely to -timestamp if provided or allowed.
 *       Currency and numeric parsing: documents may contain currency strings (e.g., \"$1.23\"). Server-side aggregation
 *       and clients defensively coerce to numbers where needed. Prefer storing total_cost as a number.
 *     tags: [LLMCosts]
 *     operationId: listLlmCosts
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         schema: { type: string }
 *         required: false
 *         description: Tenant (organization) ID when JWT is not present.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Allowed values include: timestamp, created_at, _id (prefix with '-' for desc). Default -timestamp.
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: Optional JSON filter; tenant fields are ignored server-side.
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Invalid filter or missing tenant (when not bypass)
 *       403:
 *         description: Forbidden on tenant mismatch with Authorization
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Adds:
 * - Request-level timeout (default 12s, configurable via LLM_COSTS_ROUTE_TIMEOUT_MS)
 * - Default date window if client does not request pagination and no explicit date filter is provided (last 30 days)
 *   Applied on normalized timestamp: { $ifNull: ['$timestamp', '$created_at'] }
 * - Defensive error handling to avoid upstream 504s by responding with 408 on handler timeout
 */
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    // Request-level timeout smaller than typical upstream proxy to proactively respond
    const DEFAULT_TIMEOUT_MS = parseInt(process.env.LLM_COSTS_ROUTE_TIMEOUT_MS || '12000', 10);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        try { res.set('X-Server-Timeout', String(DEFAULT_TIMEOUT_MS)); } catch (_) {}
        return res.status(408).json({
          success: false,
          message: 'Request timed out while processing LLM costs. Try reducing the time window or applying pagination.',
        });
      }
    }, DEFAULT_TIMEOUT_MS);

    try {
      // Ensure indexes for common paths (non-blocking)
      try {
        const { getDb } = require('../config/db');
        getDb().then(async (db) => {
          const col = db.collection('llm-costs');
          // fire-and-forget common indexes for list path
          col.createIndex({ tenant_id: 1, timestamp: -1 }).catch(() => {});
          col.createIndex({ tenant_id: 1, created_at: -1 }).catch(() => {});
          col.createIndex({ timestamp: -1 }).catch(() => {});
          col.createIndex({ created_at: -1 }).catch(() => {});
          col.createIndex({ total_cost: -1 }).catch(() => {});
        }).catch(() => {});
      } catch (_) {}

      // If client did not explicitly paginate and no date filter, restrict to default 30-day window to avoid full scans
      const hasExplicitPagination = typeof req.query.page !== 'undefined' || typeof req.query.limit !== 'undefined';

      // Parse filter if present
      let clientFilter = {};
      if (typeof req.query.filter === 'string' && req.query.filter.trim() !== '') {
        try {
          clientFilter = JSON.parse(req.query.filter);
        } catch {
          // leave empty; downstream will validate
        }
      }

      const filterKeys = clientFilter && typeof clientFilter === 'object' ? Object.keys(clientFilter) : [];
      const hasAnyDateClause = filterKeys.some((k) =>
        ['timestamp', 'created_at', 'createdAt', 'date', 'updated_at', 'updatedAt'].includes(k)
      );

      if (!hasExplicitPagination && !hasAnyDateClause) {
        const now = new Date();
        const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const defaultDateFilter = {
          $or: [
            { timestamp: { $gte: from, $lte: now } },
            { created_at: { $gte: from, $lte: now } },
          ],
        };
        req.query.filter =
          clientFilter && typeof clientFilter === 'object' && Object.keys(clientFilter).length > 0
            ? JSON.stringify({ $and: [clientFilter, defaultDateFilter] })
            : JSON.stringify(defaultDateFilter);
        try { res.set('X-Default-Date-Window', 'last-30-days'); } catch (_) {}
      }

      if (timedOut) return;
      return controller.list(req, res);
    } catch (err) {
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: err?.message });
      }
      return;
    } finally {
      clearTimeout(timer);
    }
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
