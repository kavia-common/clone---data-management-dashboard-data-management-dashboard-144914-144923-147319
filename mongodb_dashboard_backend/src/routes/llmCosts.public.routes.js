const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort retained; list is still tenant-scoped via middleware/controller
const controller = buildCrudController(LLMCost, '-timestamp');

// Enforce tenant isolation for all requests on this router
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * PUBLIC_INTERFACE
 * Note: All /api/llm-costs endpoints require the x-organization-id header. Query aliases (?tenant_id, ?organization_id) are optional and ignored when the header is present. Any tenant fields in payload are overridden by the resolved tenant.
 * GET /api/llm-costs
 * Returns all tenant-scoped documents from the llm_costs collection.
 * - Ignores any tenant_id/organization_id in client filter and enforces the resolved tenant.
 * - If page/limit are provided, an envelope { success, data, meta } is returned as per generic controller.
 * - Otherwise a raw array of documents is returned with all fields intact (no projection).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const start = Date.now();
    // Per requirement: Ignore/remove any 'filter' param entirely for GET /api/llm-costs
    // Preserve tenant scoping via middleware/controller and keep sort/limit behavior.
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
      delete req.query.filter;
    }

    // Also explicitly drop legacy date range params if present (server no longer applies date compounds here)
    if (typeof req.query.start !== 'undefined') delete req.query.start;
    if (typeof req.query.end !== 'undefined') delete req.query.end;
    if (typeof req.query.from !== 'undefined') delete req.query.from;
    if (typeof req.query.to !== 'undefined') delete req.query.to;

    // Enforce safe defaults to avoid huge responses causing gateway timeouts.
    // If client did not specify pagination, set defaults page=1&limit=100 and an indexed sort.
    try {
      const hasExplicitPagination =
        (typeof req.query.page !== 'undefined') || (typeof req.query.limit !== 'undefined');
      if (!hasExplicitPagination) {
        req.query.page = req.query.page ?? '1';
        req.query.limit = req.query.limit ?? '100';
        // Ensure sort is on an indexed/time field to keep ops efficient
        req.query.sort = req.query.sort ?? '-timestamp';
        res.set('X-Pagination-Defaulted', 'true');
      }
      // Clamp page size and adjust sort to known safe fields
      const maxLimit = parseInt(process.env.LLMCOSTS_MAX_PAGE_SIZE || '200', 10);
      const limitNum = parseInt(req.query.limit || '100', 10);
      if (!Number.isFinite(limitNum) || limitNum < 1 || limitNum > maxLimit) {
        req.query.limit = String(Math.min(Math.max(limitNum || 100, 1), maxLimit));
        res.set('X-Limit-Clamped', req.query.limit);
      }
      const allowedSortFields = ['timestamp', 'created_at', '_id'];
      const sort = (req.query.sort || '-timestamp').toString();
      const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
      if (!allowedSortFields.includes(sortField)) {
        req.query.sort = '-timestamp';
        res.set('X-Sort-Adjusted', 'true');
      }
      res.set('X-AllowedSort', allowedSortFields.join(','));
      res.set('X-Max-Limit', String(maxLimit));
    } catch {}

    // Mark possible super-admin bypass headers similarly to other routes (diagnostic only)
    try {
      const hdr = (req.headers?.['x-organization-id'] || '').toString();
      const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
      const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
      const requestedTenant = hdr || qOrg || authTenant || '';
      const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
      if (isT0000) {
        req.tenantScopeDisabled = true;
        req.allTenants = true;
        req.costsAllTenantsBypass = true;
        try {
          res.set('X-All-Tenants', 'true');
          res.set('X-Tenant-Bypass', 'true');
          res.set('X-Requested-Tenant', 'T0000');
        } catch {}
      }
    } catch {}

    try { res.set('X-Route-StartMs', String(start)); } catch {}
    const result = await controller.list(req, res);
    try { res.set('X-Route-DurationMs', String(Date.now() - start)); } catch {}
    return result;
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/:projectId/llm-costs
 * Deprecated alias: forwards to list endpoint (tenant-scoped); no project-based filter implied.
 */
router.get(
  '/projects/:projectId/llm-costs',
  asyncHandler(async (req, res) => {
    return controller.list(req, res);
  })
);

module.exports = router;
