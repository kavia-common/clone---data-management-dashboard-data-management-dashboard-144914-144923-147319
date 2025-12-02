'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * Early bypass detector for GET /api/session-tracking
 * Marks super-admin style bypass when tenant_id=T0000 is requested.
 */
function sessionsEarlyBypassDetector(req, res, next) {
  // Only for GET base path usage; safe no-op for others
  if (req.method !== 'GET') return next();

  const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id : undefined;
  const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : undefined;

  const hdrOrg =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
    (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
    undefined;

  const authTenant =
    (typeof req?.auth?.tenantId === 'string' && req.auth.tenantId) ||
    (typeof req?.auth?.organization_id === 'string' && req.auth.organization_id) ||
    undefined;

  const requestedTenant = hdrOrg || qOrg || qTenant || authTenant;
  const isT0000 = requestedTenant === 'T0000';

  if (isT0000) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.sessionsAllTenantsBypass = true;

    try {
      res.set('X-Tenant-Bypass', 'true');
      res.set('X-Requested-Tenant', 'T0000');
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } catch {}
  }

  return next();
}

/**
 * Diagnostic headers middleware for visibility in responses
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
          $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }],
        })
      );
    }
  } catch {}

  next();
});

const {
  getSessionTrackingAggregates,
  getSessionTrackingRaw,
} = require('../controllers/sessionTracking.analytics.controller');

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/aggregate
 * Summary: Aggregated sessions count over time
 * Query: interval=(daily|weekly|monthly|custom), start, end
 * Returns: { data: [{ date, count }], meta: { interval, start, end, total } }
 */
router.get('/aggregate', sessionsEarlyBypassDetector, asyncHandler(getSessionTrackingAggregates));

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/raw
 * Summary: Raw matched documents (minimal fields) for verification
 * Query: start, end (ISO)
 */
router.get('/raw', sessionsEarlyBypassDetector, asyncHandler(getSessionTrackingRaw));

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking
 * Summary: List session tracking records (raw list)
 * Query: limit, page, skip, tenant_id|organization_id, sort, q
 * Returns: 200 JSON; array (no pagination) or {success,data,meta} when page/limit provided
 */
router.get(
  '/',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {
    // Bypass detection
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    // Enforced tenant resolution (query/header fallbacks if not bypass)
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    // Minimal diagnostics
    try {
      res.set('X-Sessions-Bypass', String(bypass));
      const appliedTenant = bypass ? 'all-tenants' : enforcedTenant;
      res.set('X-Applied-Tenant', String(appliedTenant));
    } catch {}

    // Pagination and limit/skip handling
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;

    // Allow explicit skip in addition to page
    const skipParam = Number.isFinite(Number(rawQuery.skip)) ? Number(rawQuery.skip) : undefined;

    const { page, limit, skip: computedSkip, explicit } = parsePagination(rawQuery);
    const effectiveSkip = typeof skipParam === 'number' && skipParam >= 0 ? skipParam : computedSkip;

    // Default sort newest first by session_start
    const sort = req.query.sort || '-session_start';

    // Search filter (q)
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let qFilter = {};

    if (q) {
      const regex = new RegExp(q, 'i');
      qFilter = {
        $or: [
          { task_id: regex },
          { tenant_id: regex },
          { organization_name: regex },
          { user_name: regex },
          { User_name: regex },
          { project_id: regex },
          { container_id: regex },
          { service_type: regex },
          { status: regex },
          { user_id: regex },
          { 'session_data.session_name': regex },
          { 'session_data.description': regex },
          { 'session_data.llm_model': regex },
        ],
      };
    }

    // Optional JSON filter if provided (strip tenant fields)
    let filter = {};
    if (typeof req.query.filter !== 'undefined') {
      try {
        const raw =
          typeof req.query.filter === 'string' ? JSON.parse(req.query.filter) : req.query.filter;
        if (raw && typeof raw === 'object') {
          filter = { ...raw };
          delete filter.organization_id;
          delete filter.tenant_id;
          delete filter.organizationId;
        }
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
      }
    }

    // Tenant enforced scope
    const enforcedScope =
      !bypass && enforcedTenant
        ? {
            $or: [
              { tenant_id: enforcedTenant },
              { organization_id: enforcedTenant },
              { organizationId: enforcedTenant },
            ],
          }
        : {};

    // Combine filters
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

    if (!isEmpty(filter)) parts.push(filter);
    if (!isEmpty(qFilter)) parts.push(qFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);

    const finalFilter = parts.length > 1 ? { $and: parts } : parts[0] || {};

    // Execute
    try {
      // Minimal logging headers
      try {
        res.set('X-List-Limit', String(limit || ''));
        res.set('X-List-Skip', String(effectiveSkip || 0));
      } catch {}

      // Envelope when explicit pagination is provided
      if (explicit || typeof rawQuery.limit !== 'undefined' || typeof rawQuery.page !== 'undefined') {
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(effectiveSkip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);

        return res.status(200).json({
          success: true,
          data: docs,
          meta: { page, limit, total },
        });
      }

      // Lightweight cap when only limit/skip present without page
      if (typeof rawQuery.limit !== 'undefined' || typeof rawQuery.skip !== 'undefined') {
        const docs = await SessionTracking.find(finalFilter)
          .sort(sort)
          .skip(effectiveSkip)
          .limit(limit || 50);
        return res.status(200).json(docs);
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      return res.status(200).json(docs);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || '',
      });
    }
  })
);

// CRUD passthroughs
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
