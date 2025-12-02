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
 *       Currency and numeric parsing: documents may contain currency strings (e.g., "$1.23"). Server-side aggregation
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
router.get('/', (req, res, next) => {
  try { 
    res.set('X-Route', '/api/llm-costs'); 
    res.set('Cache-Control', 'no-store');
  } catch (_) {}

  // Send early headers to avoid upstream 60s timeout while server works
  try {
    if (!res.headersSent) {
      // Immediately flush a small preamble for proxies that use activity-based timeouts
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'X-Stream-Preamble': 'true' });
      // Write a harmless whitespace/heartbeat to keep the connection alive before heavy DB work
      res.write(' ');
    }
  } catch (_) {}

  // Guardrails: if no explicit pagination, set a soft default to avoid huge payloads
  const hasPage = Object.prototype.hasOwnProperty.call(req.query || {}, 'page');
  const hasLimit = Object.prototype.hasOwnProperty.call(req.query || {}, 'limit');
  if (!hasPage && !hasLimit) {
    // Keep raw array response but limit server-side items to reduce timeout risk
    // crudFactory caps non-explicit to 200 already
    req.query = Object.assign({}, req.query);
  }

  // Defer to controller; it will respond with proper JSON envelope/body.
  // If we pre-wrote headers, controller will still be able to end/finish the response because we didn't finish it here.
  next();
}, asyncHandler(async (req, res, next) => {
  // Use controller.list to produce the body; if response already started with headers, the controller will end it.
  try {
    await controller.list(req, res);
  } catch (e) {
    next(e);
  } finally {
    // Ensure we end the stream if we had written a heartbeat
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch (_) {}
  }
}));

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
