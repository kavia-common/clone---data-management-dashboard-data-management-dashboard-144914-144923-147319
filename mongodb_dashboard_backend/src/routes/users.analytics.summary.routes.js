'use strict';

const express = require('express');
const router = express.Router();
const { getUsersTenantSummary } = require('../controllers/users.analytics.summary.controller');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * Minimal async handler to catch errors in async route handlers and forward to Express error middleware.
 * This avoids introducing new dependencies and keeps behavior consistent across routes.
 */
function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/tenant-summary
 * Returns aggregated user counts by tenant with optional filters.
 *
 * Swagger:
 * @swagger
 * /api/users/tenant-summary:
 *   get:
 *     summary: Users by tenant (summary)
 *     description: Aggregates users grouped by tenant_id/organization_id with optional date range and status filters. Optionally excludes inactive tenants.
 *     tags:
 *       - Analytics
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO start datetime (inclusive)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO end datetime (inclusive)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Pipe-delimited statuses to include (e.g., "active|completed")
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include tenants with inactive status
 *     responses:
 *       200:
 *         description: Aggregated users by tenant
 *       400:
 *         description: Invalid parameters
 *       503:
 *         description: Database not connected
 *       500:
 *         description: Internal server error
 */
router.get('/tenant-summary', extractOrganization(), asyncHandler(async (req, res) => {
  const debugEnabled = String(req.query.debug || 'false') === 'true';

  // Call controller to compute items, then map to array for frontend compatibility
  const fakeRes = {
    _status: 200,
    _sent: false,
    status(code) { this._status = code; return this; },
    json(payload) { this._sent = true; this._payload = payload; return this; }
  };
  // Inject organization scope hint for controller (if it reads req.organizationId)
  req.scopedTenantId = req.organizationId;

  await getUsersTenantSummary(req, fakeRes);
  // Reduce payload strictly to the same organization to prevent cross-org leaks
  if (fakeRes._status === 200 && fakeRes._payload && Array.isArray(fakeRes._payload.items)) {
    fakeRes._payload.items = fakeRes._payload.items.filter((it) => String(it.tenant_id) === String(req.organizationId));
  }
  if (!fakeRes._sent) {
    return res.status(500).json({ success: false, message: 'Controller did not respond' });
  }
  if (fakeRes._status !== 200) {
    return res.status(fakeRes._status).json(fakeRes._payload);
  }
  const items = Array.isArray(fakeRes._payload.items) ? fakeRes._payload.items : [];
  const mapped = items.map(it => ({
    tenant: it.tenant_name || it.tenant_id || '',
    count: typeof it.user_count === 'number' ? it.user_count : 0,
  }));

  if (debugEnabled) {
    res.setHeader('X-Debug-Tenant-Filter', JSON.stringify({ tenant_id: req.organizationId }));
  }
  return res.status(200).json({
    items: mapped,
    total: mapped.length,
    meta: debugEnabled ? { debug: { tenant_id: req.organizationId } } : undefined,
  });
}));



/** Explicit router export for clarity */
module.exports = router;
