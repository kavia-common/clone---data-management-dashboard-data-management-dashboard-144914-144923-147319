'use strict';

const express = require('express');
const router = express.Router();
const { computeOverviewAnalytics } = require('../controllers/analytics.overview.controller');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/overview
 * Returns time-bucketed overview metrics for the dashboard.
 */
router.head('/overview', (req, res) => {
  res.set('X-Endpoint', 'analytics-overview').set('Cache-Control', 'no-store').status(204).end();
});
router.options('/overview', (req, res) => res.sendStatus(204));
router.get('/overview', verifyAuth, requireTenant, computeOverviewAnalytics);

module.exports = router;
