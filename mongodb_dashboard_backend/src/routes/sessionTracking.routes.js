/* Removed legacy commented duplicate handler block to reduce noise and avoid potential linter tooling confusion. */

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { isValidISODate, parseISODateSafe } = require('../utils/date');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * Early bypass detector for GET /api/session-tracking
 */
function sessionsEarlyBypassDetector(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/') return next();

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

    res.set('X-Tenant-Bypass', 'true');
    res.set('X-Requested-Tenant', 'T0000');
    res.set('X-All-Tenants', 'true');
    res.set('X-Applied-Tenant', 'all-tenants');
  }

  return next();
}

/**
 * Diagnostic headers middleware
 */
router.use((req, res, next) => {
  try {
    if (req.tenantScopeDisabled || req.allTenants) {
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } else if (req.tenantId) {
      const t = String(req.tenantId);
      res.set('X-Applied-Tenant', t);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: t },
          { organization_id: t },
          { organizationId: t },
        ]
      }));
    }
  } catch {}

  next();
});

const { getSessionTrackingAggregates, getSessionTrackingRaw } = require('../controllers/sessionTracking.analytics.controller');

// Aggregation endpoint must be defined before the generic list endpoint to avoid shadowing query param handling
/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking
 * Summary: Aggregated sessions count over time
 * Query: interval=(daily|weekly|monthly|custom), start, end
 * Returns: { data: [{ date, count }], meta: { interval, start, end, total } }
 */
router.get(
  '/',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {
    // Basic request diagnostics
    try {
      console.log('[GET /api/session-tracking] query=', req.query, 'headers(x-organization-id)=', req.headers['x-organization-id']);
    } catch (_) {}

    // Accept tenant from middleware or aliases. Allow superadmin/T0000 bypass.
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.sessionsAllTenantsBypass || req?.user?.isSuperAdmin);

    // Resolve tenant safely
    const resolvedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    // Interval support: daily|weekly|monthly|custom (default daily)
    const rawInterval = String(req.query.interval || 'daily').toLowerCase();
    const allowedIntervals = ['daily', 'weekly', 'monthly', 'custom'];
    const interval = allowedIntervals.includes(rawInterval) ? rawInterval : 'daily';

    // Date inputs: accept both start/end and start_date/end_date (aliases)
    const startStr = req.query.start || req.query.start_date;
    const endStr = req.query.end || req.query.end_date;

    // Sanitize limit; optional
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 20;
    if (limit > 200) limit = 200;

    // Log applied headers for troubleshooting
    try {
      res.set('X-Requested-Interval', interval);
      res.set('X-Requested-Limit', String(limit));
      if (bypass) {
        res.set('X-Tenant-Bypass', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (resolvedTenant) {
        res.set('X-Applied-Tenant', String(resolvedTenant));
      }
    } catch (_) {}

    // Validate tenant for non-bypass requests
    if (!bypass && !resolvedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=... or header x-organization-id. Superadmin T0000 may bypass.',
        code: 'TENANT_REQUIRED',
      });
    }

    // Delegate to aggregate controller using same normalization as its contract
    // We pass through req.query so controller can compute defaults and validation consistently
    // But ensure req.tenantId reflects resolvedTenant when missing (for non-auth demo calls)
    if (!bypass && !req.tenantId && resolvedTenant) {
      req.tenantId = String(resolvedTenant);
    }

    // Attach normalized interval/limit so controller can use them (without mutating user input)
    req.query.interval = interval;
    req.query.limit = String(limit);
    if (startStr) req.query.start = startStr;
    if (endStr) req.query.end = endStr;

    // Use aggregate path for consistent behavior
    return getSessionTrackingAggregates(req, res);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/raw
 * Summary: Raw matched documents (minimal fields) for verification
 * Query: start, end (ISO)
 */
router.get('/raw', sessionsEarlyBypassDetector, asyncHandler(getSessionTrackingRaw));

// PUBLIC_INTERFACE
// GET /api/session-tracking/records
// A thin raw listing for diagnostics; supports tenant_id and optional limit. No pagination envelope.
// Returns 200 with array or 204 when no data.
router.get(
  '/records',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {
    try {
      const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.sessionsAllTenantsBypass || req?.user?.isSuperAdmin);

      const resolvedTenant =
        req.tenantId ||
        (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        null;

      if (!bypass && !resolvedTenant) {
        return res.status(400).json({ success: false, message: 'tenant_id is required', code: 'TENANT_REQUIRED' });
      }

      // Accept and clamp limit
      let limit = parseInt(req.query.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0) limit = 20;
      if (limit > 200) limit = 200;

      const match = {};
      if (!bypass) {
        match.$or = [
          { tenant_id: String(resolvedTenant) },
          { organization_id: String(resolvedTenant) },
          { organizationId: String(resolvedTenant) },
        ];
      }

      const items = await SessionTracking.find(match)
        .sort({ session_start: -1 })
        .limit(limit)
        .lean();

      try {
        res.set('X-Requested-Limit', String(limit));
        res.set('X-Applied-Tenant', bypass ? 'all-tenants' : String(resolvedTenant));
      } catch (_) {}

      if (!items || items.length === 0) {
        return res.status(204).send();
      }
      return res.status(200).json(items);
    } catch (err) {
      return res.status(400).json({ success: false, message: 'Request failed', details: err?.message || '' });
    }
  })
);

// Backwards compatible list endpoint retained at GET /api/session-tracking (when no interval param provided legacy code used this path).
// Move legacy list to /api/session-tracking/list to avoid clash, and keep old handler mounted at /list.
router.get(
  '/list',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {

    // --------------------------------------------------
    // FIXED: Single bypass variable, declared once
    // --------------------------------------------------
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    // --------------------------------------------------
    // FIXED: Single enforcedTenant variable
    // --------------------------------------------------
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    // If not bypassing and no tenant provided → error
    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    // --------------------------------------------------
    // Request logging
    // --------------------------------------------------
    try {
      res.set('X-Sessions-Bypass', String(bypass));
      const appliedTenant = bypass ? 'all-tenants' : enforcedTenant;
      res.set('X-Applied-Tenant', String(appliedTenant));
    } catch {}

    // Pagination
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;

    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // --------------------------------------------------
    // Search filter
    // --------------------------------------------------
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

    // --------------------------------------------------
    // Filtering changes per requirement:
    // - Ignore/remove any 'filter' query parameter entirely.
    // - Do not construct or apply compound date filters from start/end.
    // - Retain tenant/organization scoping and optional text search (q).
    // --------------------------------------------------

    // Explicitly ignore 'filter' param if present
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
    }
    const filter = {}; // no additional filter from client

    // Tenant enforced scope (unchanged)
    const enforcedScope = (!bypass && enforcedTenant)
      ? {
          $or: [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
          ],
        }
      : {};

    // Do not apply server-side date filters for this listing endpoint now
    const timeFilter = {};

    // Combine qFilter and enforcedScope only
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

    if (!isEmpty(qFilter)) parts.push(qFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);

    const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

    // --------------------------------------------------
    // Execute
    // --------------------------------------------------
    try {
      if (explicit) {
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);

        return res.json({
          success: true,
          data: docs,
          meta: { page, limit, total }
        });
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      return res.json(docs);

    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || ''
      });
    }
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
