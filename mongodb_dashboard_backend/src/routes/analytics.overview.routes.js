'use strict';

const express = require('express');
const router = express.Router();

// Import the correct controller name exported by controllers/analytics.overview.controller.js
// That file exports "overviewMetrics", not "computeOverviewAnalytics"
const { overviewMetrics } = require('../controllers/analytics.overview.controller');

// Do NOT attach verifyAuth/requireTenant here since src/routes/index.js mounts this router
// behind verifyAuth + requireTenant already. Double-applying could lead to confusion.
// Keep this router self-contained for head/options and handler registration only.

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/overview
 * Returns overview metrics for the dashboard.
 * Note: Mounted under /api/analytics in routes/index.js
 */
router.head('/overview', (req, res) => {
  res
    .set('X-Endpoint', 'analytics-overview')
    .set('Cache-Control', 'no-store')
    .status(204)
    .end();
});

router.options('/overview', (req, res) => res.sendStatus(204));

// Main route handler (middleware applied at mount level)
router.get('/overview', overviewMetrics);

module.exports = router;
