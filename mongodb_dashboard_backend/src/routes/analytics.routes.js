'use strict';

const express = require('express');
const router = express.Router();

// Grouped analytics routes
// LLM cost by agent is available via /api/costs or /api/llm-costs modules.

// Users new-over-time is served by services/analytics.users.newOverTime.service if required in future.

// Sessions by Type time-series
const sessionsByTypeRoutes = require('../controllers/analytics.sessionsByType.controller');
router.use(sessionsByTypeRoutes);

// Also expose sessions-per-day route here for consistency when mounted via routes/index.js
try {
  const sessionsPerDayRouter = require('./analytics.sessionsPerDay.routes');
  router.use(sessionsPerDayRouter);
} catch (e) {
  // eslint-disable-next-line no-console
  console.warn('[analytics.routes] sessions-per-day router not loaded:', e?.message || e);
}

module.exports = router;
