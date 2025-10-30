'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { aggregateAgentsUsageAndCost, aggregateCostsByDepartment } = require('../utils/agentsAggregation');

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
 * Notes:
 *  - Always responds with 200 and an items array; on errors returns items:[], meta.error for UI resilience.
 */
router.get('/', async (req, res) => {
  try {
    const { tenant_id, project_id } = req.query;
    const grouping = (req.query.grouping || 'agent').toString().toLowerCase();
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
          return res.status(200).json({ items: [], total: 0, meta: { error: 'Invalid from date' } });
        }
        from = d.toISOString();
      }
      if (to) {
        const d = new Date(to);
        if (isNaN(d.getTime())) {
          return res.status(200).json({ items: [], total: 0, meta: { error: 'Invalid to date' } });
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
      return res.status(200).json({ items: [], total: 0, meta: { error: 'Database not connected' } });
    }
    if (!db) {
      return res.status(200).json({ items: [], total: 0, meta: { error: 'Database not connected' } });
    }

    // grouping parameter handling
    if (grouping === 'department') {
      try {
        const result = await aggregateCostsByDepartment(db, {
          tenant_id,
          project_id,
          from,
          to,
          limit,
          offset,
        });
        return res.json(result);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[analytics/agents] department aggregation error:', e?.message || e);
        return res.status(200).json({ items: [], total: 0, meta: { error: 'Aggregation error' } });
      }
    }

    // Default path: group by agent
    try {
      const result = await aggregateAgentsUsageAndCost(db, {
        tenant_id,
        project_id,
        from,
        to,
        limit,
        offset,
      });
      return res.json(result);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[analytics/agents] agent aggregation error:', e?.message || e);
      return res.status(200).json({ items: [], total: 0, meta: { error: 'Aggregation error' } });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in /api/analytics/agents:', err);
    return res.status(200).json({ items: [], total: 0, meta: { error: 'Internal server error' } });
  }
});

module.exports = router;
