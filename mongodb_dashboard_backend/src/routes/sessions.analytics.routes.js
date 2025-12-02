'use strict';

const express = require('express');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { asyncHandler } = require('../utils/http');
const { sessionsByType, sessionsByOrganization } = require('../services/sessions.aggregates.service');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Sessions Analytics Router
 * Provides fast, aggregated endpoints for Session Tracking charts.
 *
 * Required indexes (MongoDB):
 *   db.session_tracking.createIndex({ tenant_id: 1, last_updated: -1 })
 *   db.session_tracking.createIndex({ tenant_id: 1, session_start: -1 })
 *   db.session_tracking.createIndex({ service_type: 1 })
 *   db.session_tracking.createIndex({ session_type: 1 })
 *   db.session_tracking.createIndex({ type: 1 })
 *   db.session_tracking.createIndex({ organization_name: 1 })
 */

/**
 * Input validation helper
 */
function parseQuery(req) {
  const q = req.query || {};
  const start = typeof q.start === 'string' ? q.start : undefined;
  const end = typeof q.end === 'string' ? q.end : undefined;
  const limitRaw = q.limit != null ? Number(q.limit) : undefined;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, Math.floor(limitRaw)) : 20;

  return { start, end, limit };
}

function detectBypass(req) {
  const hdr = (req.headers?.['x-organization-id'] || '').toString();
  const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
  const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
  const requestedTenant = hdr || qOrg || authTenant || '';
  return requestedTenant && requestedTenant.toUpperCase() === 'T0000';
}

// Swagger: Sessions by Type
/**
 * @swagger
 * /api/sessions/by-type:
 *   get:
 *     summary: Sessions count by type
 *     description: |
 *       Efficient aggregation of session counts grouped by type. Uses tenant scope (JWT/header) unless organization_id is T0000 to bypass.
 *       Supports optional start/end ISO datetimes and result limit. Caches results in-memory for ~45 seconds by query key.
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *         description: ISO start datetime (inclusive)
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *         description: ISO end datetime (inclusive)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 20 }
 *         description: Max number of groups to return
 *     responses:
 *       200:
 *         description: Aggregated sessions by type
 *       400:
 *         description: Invalid parameters
 */
router.get(
  '/by-type',
  verifyAuth,
  requireTenant,
  asyncHandler(async (req, res) => {
    const { start, end, limit } = parseQuery(req);
    const allowBypass = detectBypass(req);
    const tenantId = req.tenantId;

    // Validation (dates are parsed in service; we just ensure strings)
    if (start && isNaN(new Date(start).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid start datetime' });
    }
    if (end && isNaN(new Date(end).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid end datetime' });
    }

    const items = await sessionsByType({ tenantId, start, end, limit, allowBypass });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ items, total: items.length, meta: { start, end, limit } });
  })
);

// Swagger: Sessions by Organization
/**
 * @swagger
 * /api/sessions/by-organization:
 *   get:
 *     summary: Sessions count by organization
 *     description: |
 *       Efficient aggregation of session counts grouped by organization. Uses organization_name when present, falling back to tenant_id.
 *       Tenant scope is enforced unless T0000 is used to bypass. Optional start/end ISO datetimes and limit supported.
 *       Results are in-memory cached for ~45 seconds per unique query.
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: query
 *         name: start
 *         schema: { type: string, format: date-time }
 *         description: ISO start datetime (inclusive)
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date-time }
 *         description: ISO end datetime (inclusive)
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 1000, default: 20 }
 *         description: Max number of groups to return
 *     responses:
 *       200:
 *         description: Aggregated sessions by organization
 *       400:
 *         description: Invalid parameters
 */
router.get(
  '/by-organization',
  verifyAuth,
  requireTenant,
  asyncHandler(async (req, res) => {
    const { start, end, limit } = parseQuery(req);
    const allowBypass = detectBypass(req);
    const tenantId = req.tenantId;

    if (start && isNaN(new Date(start).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid start datetime' });
    }
    if (end && isNaN(new Date(end).getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid end datetime' });
    }

    const items = await sessionsByOrganization({ tenantId, start, end, limit, allowBypass });
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({ items, total: items.length, meta: { start, end, limit } });
  })
);

module.exports = router;
