'use strict';

const express = require('express');
const router = express.Router();
const { overviewMetrics } = require('../controllers/analytics.overview.controller');
const { verifyAuth } = require('../middleware');
const { requireTenant } = require('../middleware/requireTenant');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/overview
 * Returns overview metrics for the authenticated tenant.
 */
router.use(verifyAuth, requireTenant);

router.head('/overview', (req, res) => {
  res.set('X-Endpoint', 'analytics-overview').set('Cache-Control', 'no-store').status(204).end();
});
router.options('/overview', (req, res) => res.sendStatus(204));
router.get('/overview', overviewMetrics);

module.exports = router;
