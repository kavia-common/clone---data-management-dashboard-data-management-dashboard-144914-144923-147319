'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { aggregateAgentsUsageAndCost } = require('../utils/agentsAggregation');

/**
 * GET /api/analytics/agents
 * PUBLIC_INTERFACE
 * Minimal request validation; supports filters via query:
 *  - tenant_id (string), project_id (string)
 *  - from, to (ISO date strings); defaults to last 30 days if absent
 *  - limit (default 50, max 200), offset (default 0)
 * Returns:
 *  {
 *    items: [ { agent_name, total_cost, total_usage, session_count, source_breakdown } ],
 *    total,
 *    meta: { limit, offset, from, to, tenant_id, project_id }
 *  }
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_id, project_id } = req.query;
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);

    let from = req.query.from;
    let to = req.query.to;

    // Default to last 30 days if not provided
    if (!from && !to) {
      const now = new Date();
      const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      from = defaultFrom.toISOString();
      to = now.toISOString();
    } else {
      // Best-effort validation/normalization
      if (from) {
        const d = new Date(from);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Invalid from date' });
        }
        from = d.toISOString();
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Invalid to date' });
        }
        to = d.toISOString();
      }
    }

    // Ensure DB connection; getDb is async and must be awaited
    let db = null;
    try {
      db = await getDb();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[analytics/agents] DB connection error:', e?.message || e);
      return res.status(e?.status === 503 ? 503 : 500).json({
        error: e?.status === 503 ? 'Database not connected' : 'Internal server error',
      });
    }
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    const result = await aggregateAgentsUsageAndCost(db, {
      tenant_id,
      project_id,
      from,
      to,
      limit,
      offset,
    });

    return res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in /api/analytics/agents:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
