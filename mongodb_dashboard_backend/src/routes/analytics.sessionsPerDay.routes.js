'use strict';

const express = require('express');
const router = express.Router();
const { getSessionsPerDay } = require('../services/analytics.sessionsPerDay.service');
const { asyncHandler } = require('../utils/http');

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/sessions-per-day
 * Summary: Sessions per day aggregation
 * Description:
 *   Aggregates the session_tracking collection by UTC day using session_start field and returns
 *   an array sorted by date ascending. Optional filters via query params:
 *     - tenant_id (string)
 *     - project_id (string)
 *     - status (string, supports pipe-separated list e.g. "completed|active")
 * Response:
 *   [{ date: 'YYYY-MM-DD', count: number }]
 */
async function sessionsPerDayHandler(req, res) {
  const { tenant_id, project_id, status } = req.query || {};

  // Basic validation (non-fatal: invalid types result in 400)
  if (tenant_id != null && typeof tenant_id !== 'string') {
    return res.status(400).json({ success: false, error: 'tenant_id must be a string' });
  }
  if (project_id != null && typeof project_id !== 'string') {
    return res.status(400).json({ success: false, error: 'project_id must be a string' });
  }
  if (status != null && typeof status !== 'string') {
    return res.status(400).json({ success: false, error: 'status must be a string' });
  }

  try {
    const items = await getSessionsPerDay({ tenant_id, project_id, status });
    // Return raw array per acceptance criteria
    return res.status(200).json(items);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sessions-per-day] Error:', err?.message || err);
    return res.status(err.status || 500).json({ success: false, error: 'Internal server error' });
  }
}

// Lightweight reachability endpoints
router.head('/sessions-per-day', (req, res) =>
  res.set('X-Endpoint', 'analytics-sessions-per-day').status(204).end()
);
router.options('/sessions-per-day', (req, res) => res.sendStatus(204));

router.get('/sessions-per-day', asyncHandler(sessionsPerDayHandler));

module.exports = router;
