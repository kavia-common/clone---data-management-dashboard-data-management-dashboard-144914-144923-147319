const express = require('express');
const router = express.Router();
const { overviewMetrics } = require('../controllers/analytics.overview.controller');

// PUBLIC_INTERFACE
// GET /api/analytics/overview
// Returns overview KPIs and time-bucketed series for the selected metric and time range.
// Query: metric, range, from, to
function registerOverviewRoute(r) {
  r.get('/overview', (req, res) => overviewMetrics(req, res));
  return r;
}

const analyticsOverviewRouter = registerOverviewRoute(router);

module.exports = { analyticsOverviewRouter, default: analyticsOverviewRouter };
