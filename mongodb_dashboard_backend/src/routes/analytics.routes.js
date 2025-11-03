'use strict';

const express = require('express');
const router = express.Router();

// Grouped analytics routes
// LLM cost by agent is available via /api/costs or /api/llm-costs modules.

// Users new-over-time is served by services/analytics.users.newOverTime.service if required in future.

// Sessions by Type time-series
const sessionsByTypeRoutes = require('../controllers/analytics.sessionsByType.controller');
router.use(sessionsByTypeRoutes);

module.exports = router;
