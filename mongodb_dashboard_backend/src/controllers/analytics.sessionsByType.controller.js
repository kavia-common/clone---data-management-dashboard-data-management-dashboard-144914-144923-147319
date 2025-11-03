'use strict';

const express = require('express');
const router = express.Router();

const { getSessionsByTypeTimeSeries } = require('../services/analytics.sessionsByType.service');

// PUBLIC_INTERFACE
/**
 * sessionsByTypeHandler
 * GET /api/analytics/sessions-by-type
 * Summary: Sessions by Type time-series
 * Description: Aggregates the session_tracking collection by inferred type (service_type -> type -> session_data.serviceType)
 * and returns time-bucketed counts within a date range. Defaults to last 30 days and granularity=day.
 * Query:
 *  - from: ISO start (inclusive), default now-30d
 *  - to: ISO end (inclusive), default now
 *  - granularity: day|week|month, default day
 *  - tenant_id: optional tenant scope
 * Response:
 *  {
 *    items: [{ date: 'YYYY-MM-DD', series: { "<type>": number }, total: number }],
 *    meta: { from, to, granularity, types: string[], bucketCount: number }
 *  }
 */
async function sessionsByTypeHandler(req, res) {
  const { from, to, granularity = 'day', tenant_id } = req.query;
  const validGranularities = ['day', 'week', 'month'];
  const g = (granularity || 'day').toLowerCase();
  if (!validGranularities.includes(g)) {
    return res.status(400).json({ success: false, error: 'Invalid granularity' });
  }

  try {
    const data = await getSessionsByTypeTimeSeries({ from, to, granularity: g, tenant_id });
    // Basic logging for diagnosis of sparse datasets
    if ((data.meta?.types?.length || 0) === 0) {
      // eslint-disable-next-line no-console
      console.warn('[sessions-by-type] No types found for given range', { from, to, tenant_id });
    }
    return res.json({ success: true, ...data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[sessions-by-type] Error:', err?.message, err?.stack);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

router.get('/sessions-by-type', sessionsByTypeHandler);

module.exports = router;
