'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const { getUsersTenantSummary } = require('../controllers/users.analytics.summary.controller');

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
router.get('/tenant-summary', asyncHandler(async (req, res) => {
  // Call controller to compute items, then map to array for frontend compatibility
  const fakeRes = {
    _status: 200,
    _sent: false,
    status(code) { this._status = code; return this; },
    json(payload) { this._sent = true; this._payload = payload; return this; }
  };
  await getUsersTenantSummary(req, fakeRes);
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
  return res.status(200).json(mapped);
}));



/** Explicit router export for clarity */
module.exports = router;
module.exports.router = router;
