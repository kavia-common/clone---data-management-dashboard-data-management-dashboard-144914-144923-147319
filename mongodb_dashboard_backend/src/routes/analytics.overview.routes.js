'use strict';

const express = require('express');
const router = express.Router();
const { overviewMetrics } = require('../controllers/analytics.overview.controller');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/overview
 * Returns overview totals and metrics for the dashboard.
 * This router is mounted under /api/analytics in src/routes/index.js
 */
router.use(verifyAuth, requireTenant);

// Guard: ensure handler is defined to avoid Express callback error
if (typeof overviewMetrics !== 'function') {
  // Throwing here makes the root cause obvious during startup
  throw new Error('analytics.overview.routes: overviewMetrics handler is not a function. Check controller exports.');
}

router.head('/overview', (req, res) => {
  res
    .set('X-Endpoint', 'analytics-overview')
    .set('Cache-Control', 'no-store')
    .status(204)
    .end();
});
router.options('/overview', (req, res) => res.sendStatus(204));
// Avoid duplicate middleware since router.use already applied them, but keeping idempotent call is harmless.
// Use the correctly imported handler.
router.get('/overview', overviewMetrics);

module.exports = router;
