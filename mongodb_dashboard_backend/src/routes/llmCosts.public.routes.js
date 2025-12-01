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
    // Implement raw collection query to return ALL fields and required tenant filter
    try {
      // Resolve tenant from query/header; organization_id is required unless superadmin T0000 bypass
      const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
      const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || '';
      const hOrg =
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) || '';
      const requested = hOrg || qOrg || qTenant || '';
      const isBypass = requested.toUpperCase() === 'T0000';

      // parse page/limit with defaults
      const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
      const limit = Math.max(Math.min(parseInt(req.query?.limit, 10) || 10, 200), 1);
      const skip = (page - 1) * limit;

      // Organization id required when not bypassing
      if (!isBypass && !requested) {
        return res.status(400).json({ success: false, message: 'organization_id is required' });
      }

      // Enforce Authorization tenant match if token present
      const hasAuth = !!req.headers?.authorization;
      const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
      if (hasAuth && requested && authTenant && requested !== authTenant) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }

      // Build filter
      let filter = {};
      if (!isBypass) {
        const t = requested || authTenant;
        filter = {
          $or: [
            { tenant_id: String(t) },
            { organization_id: String(t) },
            { tenantId: String(t) },
            { organizationId: String(t) },
            { orgId: String(t) },
            { 'tenant.tenant_id': String(t) },
          ],
        };
        try {
          res.set('X-Applied-Tenant', String(t));
        } catch (_) {}
      } else {
        try {
          res.set('X-All-Tenants', 'true');
          res.set('X-Applied-Tenant', 'all-tenants');
        } catch (_) {}
      }

      // Use native collection to avoid projections so we return all fields
      const { getCollection } = require('../config/db');
      const col = await getCollection(['llm-costs', 'llm_costs', 'llmCosts']);

      // Count and fetch
      const total = await col.countDocuments(filter);
      const cursor = col.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit);
      const data = await cursor.toArray();

      const totalPages = Math.max(Math.ceil(total / limit), 1);
      return res.status(200).json({
        data,
        page,
        limit,
        total,
        totalPages,
      });
    } catch (err) {
      console.error('[GET /api/llm-costs] error:', err?.message || err);
      return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
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
