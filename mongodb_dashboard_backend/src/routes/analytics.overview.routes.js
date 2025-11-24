const express = require('express');
const router = express.Router();
const { overviewMetrics } = require('../controllers/analytics.overview.controller');

// PUBLIC_INTERFACE
// GET /api/analytics/overview
// Returns overview KPIs and time-bucketed series for the selected metric and time range.
// Query: metric, range, from, to
router.get('/overview', async (req, res) => {
  return overviewMetrics(req, res);
});

module.exports = router;
