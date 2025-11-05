'use strict';

const express = require('express');
const { computeOverviewAnalytics } = require('../controllers/analytics.overview.controller');
const { bearerAuthAttach } = require('../middleware/jwtAuth');

const router = express.Router();

// Require bearer auth for all analytics overview routes
router.use(bearerAuthAttach());

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/new-over-time
 * Delegates to controller that computes new users over time.
 */
router.get('/users/new-over-time', (req, res, next) => {
  // Controller will read query params. Tenant scoping can be applied by the controller
  // using req.user.tenant_id if necessary.
  return computeOverviewAnalytics(req, res, next);
});

// HEAD and OPTIONS are no-ops here but keep route surface similar
router.head('/users/new-over-time', (req, res) => res.status(200).end());
router.options('/users/new-over-time', (req, res) => res.status(204).end());

module.exports = router;
