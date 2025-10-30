'use strict';

/**
 * Users Analytics - Activity and Summary Routes
 * Additive routes mounted under /api/analytics/users
 * Computes DAU/WAU/MAU style metrics based on users collection updated_at timestamps.
 */

const express = require('express');
const router = express.Router();

// Lazy import to avoid circular deps in some setups
const db = require('../config/db');
const User = require('../models/user.model');

/**
 * Utility: parse query params safely with defaults
 */
function parseDateOr(defaultDate, value) {
  const d = value ? new Date(value) : defaultDate;
  if (isNaN(d.getTime())) return defaultDate;
  return d;
}

const VALID_GRANULARITIES = new Set(['daily', 'weekly', 'monthly']);
const VALID_ROLES = new Set(['all', 'admin', 'user']);

function normGranularity(g) {
  if (!g) return 'daily';
  const v = String(g).toLowerCase();
  return VALID_GRANULARITIES.has(v) ? v : 'daily';
}

function normRole(r) {
  if (!r) return 'all';
  const v = String(r).toLowerCase();
  return VALID_ROLES.has(v) ? v : 'all';
}

function getDateTruncParams(granularity) {
  switch (granularity) {
    case 'weekly':
      return { unit: 'week' };
    case 'monthly':
      return { unit: 'month' };
    case 'daily':
    default:
      return { unit: 'day' };
  }
}

function addTZ(date) {
  // Ensure ISO string in UTC without milliseconds for consistency
  return new Date(date).toISOString();
}

/**
 * Build $match for users collection based on filters.
 * Active user definition: status === 'active'
 * Optional: department, organization_id (tenant), role (is_admin true/false), status override
 */
function buildMatch({ start, end, role, department, status, organization_id }) {
  const match = {
    updated_at: { $gte: start, $lte: end },
  };

  // Status handling (default to 'active' as per requirements)
  match.status = status || 'active';

  if (department) {
    match.department = department;
  }

  if (organization_id) {
    match.organization_id = organization_id;
  }

  if (role === 'admin') {
    match.is_admin = true;
  } else if (role === 'user') {
    match.is_admin = false;
  }

  return match;
}

/**
 * GET /api/analytics/users/activity
 * Query:
 *  - granularity: daily|weekly|monthly (default daily)
 *  - start: ISO (default now-30d)
 *  - end: ISO (default now)
 *  - role: admin|user|all (default all)
 *  - department: optional
 *  - status: optional (default 'active')
 *  - organization_id: optional (tenant scope)
 *
 * Response:
 * {
 *   granularity: 'daily',
 *   start, end,
 *   buckets: [
 *     { bucketStart: '2025-01-01T00:00:00Z', total: 42, admin: 7, user: 35 },
 *     ...
 *   ]
 * }
 */
// PUBLIC_INTERFACE
router.get(
  '/activity',
  /**
   * Users activity time series by granularity.
   * Buckets users by updated_at with $dateTrunc and returns totals + role splits.
   */
  async (req, res) => {
    try {
      // Ensure DB is connected
      if (!db.connection || db.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database not connected' });
      }

      const granularity = normGranularity(req.query.granularity);
      const role = normRole(req.query.role);

      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setDate(now.getDate() - 30);

      const start = parseDateOr(defaultStart, req.query.start);
      const end = parseDateOr(now, req.query.end);

      const department = req.query.department ? String(req.query.department) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const organization_id = req.query.organization_id ? String(req.query.organization_id) : undefined;

      const match = buildMatch({ start, end, role, department, status, organization_id });
      const { unit } = getDateTruncParams(granularity);

      // Aggregation: group by bucket and compute counts including role splits
      const pipeline = [
        { $match: match },
        {
          $addFields: {
            bucket: {
              $dateTrunc: {
                date: '$updated_at',
                unit,
                timezone: 'UTC',
              },
            },
          },
        },
        {
          $group: {
            _id: '$bucket',
            total: { $sum: 1 }, // counting documents (each user counted per matching doc); this approximates activity touches
            admin: {
              $sum: { $cond: [{ $eq: ['$is_admin', true] }, 1, 0] },
            },
            user: {
              $sum: { $cond: [{ $eq: ['$is_admin', false] }, 1, 0] },
            },
          },
        },
        { $sort: { _id: 1 } },
      ];

      const raw = await User.aggregate(pipeline).allowDiskUse(true);

      // Fill missing intervals with zeros to ensure smooth charts
      const buckets = [];
      // Build an index from aggregation
      const idx = new Map();
      raw.forEach((r) => {
        idx.set(new Date(r._id).toISOString(), {
          bucketStart: new Date(r._id).toISOString(),
          total: r.total || 0,
          admin: r.admin || 0,
          user: r.user || 0,
        });
      });

      // Walk from start to end by unit
      const cursor = new Date(start);
      const endClip = new Date(end);
      function inc(d) {
        if (unit === 'day') d.setUTCDate(d.getUTCDate() + 1);
        else if (unit === 'week') d.setUTCDate(d.getUTCDate() + 7);
        else if (unit === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
      }
      // Align to bucket boundary via dateTrunc-like behavior
      function align(d) {
        const a = new Date(d);
        if (unit === 'day') {
          a.setUTCHours(0, 0, 0, 0);
        } else if (unit === 'week') {
          // Set to Monday 00:00:00 UTC (Mongo $dateTrunc with week uses ISO week starting Monday)
          const day = a.getUTCDay(); // 0 Sun ... 6 Sat
          const diff = (day + 6) % 7; // days since Monday
          a.setUTCDate(a.getUTCDate() - diff);
          a.setUTCHours(0, 0, 0, 0);
        } else if (unit === 'month') {
          a.setUTCDate(1);
          a.setUTCHours(0, 0, 0, 0);
        }
        return a;
      }
      let aligned = align(cursor);
      while (aligned <= endClip) {
        const key = aligned.toISOString();
        const val = idx.get(key) || {
          bucketStart: key,
          total: 0,
          admin: 0,
          user: 0,
        };
        buckets.push(val);
        inc(aligned);
      }

      return res.json({
        granularity,
        start: addTZ(start),
        end: addTZ(end),
        buckets,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('users.analytics.activity error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * GET /api/analytics/users/summary?window=7|30|90
 * Computes DAU/WAU/MAU values and percent change vs previous same window using users.updated_at approximations.
 *
 * Response:
 * {
 *   window: 30,
 *   dau: { value: 23, changePct: 12.5 },
 *   wau: { value: 77, changePct: -3.1 },
 *   mau: { value: 301, changePct: 2.0 }
 * }
 */
// PUBLIC_INTERFACE
router.get(
  '/summary',
  /**
   * Users active summary for 1/7/30 days and their deltas versus previous window.
   */
  async (req, res) => {
    try {
      if (!db.connection || db.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database not connected' });
      }

      const windowParam = parseInt(String(req.query.window || '30'), 10);
      const windowDays = [7, 30, 90].includes(windowParam) ? windowParam : 30;

      const now = new Date();
      const end = now;
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - windowDays);

      const prevEnd = new Date(start);
      const prevStart = new Date(prevEnd);
      prevStart.setUTCDate(prevStart.getUTCDate() - windowDays);

      async function distinctActiveUsersBetween(a, b) {
        // Active definition status === 'active'; count distinct _id having updated_at in range.
        const pipeline = [
          {
            $match: {
              status: 'active',
              updated_at: { $gte: a, $lte: b },
            },
          },
          { $group: { _id: '$_id' } },
          { $count: 'count' },
        ];
        const r = await User.aggregate(pipeline);
        return r?.[0]?.count || 0;
      }

      async function valueAndDelta(days) {
        const endX = new Date(now);
        const startX = new Date(endX);
        startX.setUTCDate(startX.getUTCDate() - days);

        const prevEndX = new Date(startX);
        const prevStartX = new Date(prevEndX);
        prevStartX.setUTCDate(prevStartX.getUTCDate() - days);

        const [curr, prev] = await Promise.all([
          distinctActiveUsersBetween(startX, endX),
          distinctActiveUsersBetween(prevStartX, prevEndX),
        ]);
        const changePct = prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100;
        return { value: curr, changePct: Math.round(changePct * 10) / 10 };
      }

      const [dau, wau, mau] = await Promise.all([valueAndDelta(1), valueAndDelta(7), valueAndDelta(30)]);

      return res.json({
        window: windowDays,
        dau,
        wau,
        mau,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('users.analytics.summary error', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
