'use strict';

const express = require('express');
const router = express.Router();

const {
  dailyActive,
  byDepartment,
  activeVsInactive,
  topActive,
  summary,
  ensureUsersAnalyticsIndexes,
} = require('../controllers/users.analytics.metrics.controller');

// Initialize indexes once on first import (best-effort)
ensureUsersAnalyticsIndexes().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Failed to ensure users analytics indexes', e);
});

/**
 * Route registrations
 *
 * Note: Route handlers return JSON with ISO dates and counts as per requirements.
 */

// PUBLIC_INTERFACE
// GET /api/users/analytics/daily-active?days=30
router.get('/daily-active', dailyActive);

// PUBLIC_INTERFACE
// GET /api/users/analytics/by-department?windowDays=14
router.get('/by-department', byDepartment);

// PUBLIC_INTERFACE
// GET /api/users/analytics/active-vs-inactive?windowDays=14
router.get('/active-vs-inactive', activeVsInactive);

// PUBLIC_INTERFACE
// GET /api/users/analytics/top-active?limit=10&windowDays=30
router.get('/top-active', topActive);

// PUBLIC_INTERFACE
// GET /api/users/analytics/summary
router.get('/summary', summary);

module.exports = router;
