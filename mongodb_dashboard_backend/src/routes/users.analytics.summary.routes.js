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
router.get('/tenant-summary', asyncHandler(getUsersTenantSummary));

/**
 * PUBLIC_INTERFACE
 * GET /api/users/tenant-summary/health
 * Simple health endpoint to verify that the users.analytics.summary router is mounted.
 */
router.get('/tenant-summary/health', (req, res) => {
  return res.status(200).json({ ok: true, router: 'users.analytics.summary' });
});

module.exports = router;
