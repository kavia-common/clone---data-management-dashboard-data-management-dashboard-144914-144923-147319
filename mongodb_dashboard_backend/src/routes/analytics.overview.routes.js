'use strict';

const express = require('express');
const router = express.Router();
// Import the correct exported controller function
const { overviewMetrics } = require('../controllers/analytics.overview.controller');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/overview
 * Returns dashboard overview totals for the authenticated tenant.
 *
 * Notes:
 * - This router is also mounted under verifyAuth + requireTenant in src/app.js and src/routes/index.js.
 * - We keep router-level protection for defense-in-depth without duplicating per-route middlewares.
 */
router.use(verifyAuth, requireTenant);

router.head('/overview', (req, res) => {
  res
    .set('X-Endpoint', 'analytics-overview')
    .set('Cache-Control', 'no-store')
    .status(204)
    .end();
});
router.options('/overview', (req, res) => res.sendStatus(204));

// Use the valid controller function; avoid duplicating verifyAuth/requireTenant here
router.get('/overview', overviewMetrics);

module.exports = router;
