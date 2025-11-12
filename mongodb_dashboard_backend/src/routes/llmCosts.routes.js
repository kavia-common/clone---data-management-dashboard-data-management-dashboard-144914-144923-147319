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
    // Make sure browsers can read diagnostics headers
    res.set(
      'Access-Control-Expose-Headers',
      'Content-Type,Content-Length,X-Applied-Tenant,x-applied-organization-id,x-applied-tenant-filter,X-Model-Collection,X-Probe-Count,X-DB-Name,X-Applied-Filter-Strategy,X-Applied-Filter-Keys,X-Forced-Organization-Id'
    );
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
    // Guarded toggle: when enabled, force organization_id to a static value (default 'T0000') for verification.
    // Set LLM_COSTS_FORCE_ORG_ID in environment to activate. Example: LLM_COSTS_FORCE_ORG_ID=T0000
    const forcedOrgEnv = process.env.LLM_COSTS_FORCE_ORG_ID;
    const isForcedEnabled = !!forcedOrgEnv && String(forcedOrgEnv).trim().length > 0;
    const forcedOrgId = isForcedEnabled ? String(forcedOrgEnv).trim() : null;

    // Resolve requested org from query (normal path)
    const requestedOrgId = typeof req.query?.organization_id === 'string' ? req.query.organization_id.trim() : '';

    // Choose effective org: forced takes precedence when enabled
    const effectiveOrgId = isForcedEnabled ? forcedOrgId : requestedOrgId;

    if (!effectiveOrgId) {
      return res.status(400).json({ success: false, message: 'Missing required query parameter: organization_id' });
    }

    // Preserve existing auth middleware; do not override tenant from JWT when NOT forcing.
    // If Authorization is present and JWT tenant is different from the effective organization_id, reject with 403.
    const jwtTenant = req?.tenantId ? String(req.tenantId) : undefined;
    if (req.headers?.authorization && jwtTenant && jwtTenant !== effectiveOrgId) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    // Prepare pagination
    const { parsePagination } = require('../utils/http');
    const { page, limit, skip, explicit } = parsePagination(req.query);

    // Build strict filter on organization_id only. Do not strip organization_id.
    const baseFilter = { organization_id: effectiveOrgId };

    // Optional client filter: allow non-tenant fields only; never remove or override organization_id.
    let clientFilter = {};
    if (req.query && req.query.filter) {
      try {
        const parsed = typeof req.query.filter === 'string' ? JSON.parse(req.query.filter) : req.query.filter;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          clientFilter = { ...parsed };
          // Do NOT delete organization_id per requirement.
          // Remove nested tenant aliases that could conflict
          delete clientFilter.tenant_id;
          delete clientFilter.tenantId;
          delete clientFilter.organizationId;
          delete clientFilter.orgId;
          delete clientFilter['tenant.tenant_id'];
        }
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    // Applied filter is strictly AND with organization_id
    const appliedFilter = Object.keys(clientFilter).length ? { $and: [baseFilter, clientFilter] } : baseFilter;

    // Diagnostics
    try {
      res.set('X-Applied-Tenant', effectiveOrgId);
      res.set('x-applied-organization-id', effectiveOrgId);
      res.set('x-applied-tenant-filter', JSON.stringify(appliedFilter));
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm_costs');
      res.set('X-Applied-Filter-Strategy', isForcedEnabled ? 'forced_organization_id' : 'organization_id_strict');
      res.set('X-Applied-Filter-Keys', 'organization_id');
      if (isForcedEnabled) {
        res.set('X-Forced-Organization-Id', effectiveOrgId);
      }
    } catch (_) {}

    // Query with consistent meta.total and add a probe count + connection diagnostics
    const sort = '-timestamp'; // keep safe default
    try {
      // Probe: count and connection info (request-scoped)
      try {
        const probeCount = await LLMCost.countDocuments(appliedFilter);
        const mongoose = require('mongoose');
        const dbName = mongoose?.connection?.name || mongoose?.connection?.db?.databaseName || '(unknown)';
        res.set('X-Probe-Count', String(probeCount));
        res.set('X-DB-Name', dbName);
      } catch (_) {}

      if (explicit) {
        const [items, total] = await Promise.all([
          LLMCost.find(appliedFilter).sort(sort).skip(skip).limit(limit).allowDiskUse(true).lean(),
          LLMCost.countDocuments(appliedFilter),
        ]);
        return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
      }
      const items = await LLMCost.find(appliedFilter).sort(sort).allowDiskUse(true).lean();
      return res.status(200).json(items);
    } catch (err) {
      return res.status(400).json({ success: false, message: err?.message || 'Request failed' });
    }
  })
);

// Standard CRUD endpoints use the tenant-aware controller
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
