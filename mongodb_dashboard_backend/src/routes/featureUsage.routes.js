'use strict';

const express = require('express');
const router = express.Router();
const { getFeatureUsage } = require('../controllers/featureUsage.controller');
const { parseTenantContextIfAny } = require('../middleware/tenantContext'); // consistent with other routes
const { standardHandler } = require('../middleware/standardHandlers');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/feature-usage
 * Summary: Feature usage over time by service type
 * Description:
 *   Aggregates session tracking data grouped by feature and time bucket for the specified service type.
 *   Returns time-series suitable for line charts, along with most-used and least-used features.
 * Query Params:
 *   - serviceType (string, optional)
 *   - from (ISO datetime, optional)
 *   - to (ISO datetime, optional)
 *   - interval (day|week, default=day)
 */
router.get(
  '/feature-usage',
  parseTenantContextIfAny,
  // wrap the controller in the standardHandler for consistent error handling/logging
  (req, res) => standardHandler(req, res, () => getFeatureUsage(req, res))
);

module.exports = router;
