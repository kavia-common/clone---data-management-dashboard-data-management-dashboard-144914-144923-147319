'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { isValidISODate, parseISODateSafe, startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * GET /api/overview/projects
 * Aggregates "Total Projects" by joining session_tracking with app_deployments on project_id.
 * Returns DAILY buckets (YYYY-MM-DD) with fields:
 *  - date: ISO day string (YYYY-MM-DD)
 *  - bucket_start: alias of date (stable)
 *  - count: total for that day
 *  - by_user: [{ user_name, count }] breakdown for that day
 *  - by_project (optional): [{ project_name, count }] when resolvable for that day
 *
 * Timeframe handling:
 *  - timeframe=daily|weekly|monthly buckets are still per-day, but meta.bucket_kind carries 'daily'|'weekly'|'monthly' and
 *    meta.bucket_start is a stable ISO date for the bucket (start-of-day UTC). Weekly/monthly pick a wider window (7/30 days)
 *    but daily aggregation remains per calendar day.
 *  - timeframe=custom strictly uses created_at from BOTH collections (session_tracking/app_deployments) and joins on project_id.
 *    The inclusive end_date is implemented by adding +1 day to upper bound.
 *
 * Query:
 * - timeframe: 'daily' | 'weekly' | 'monthly' | 'custom' (default 'daily')
 * - start_date: YYYY-MM-DD or ISO when timeframe=custom (inclusive)
 * - end_date:   YYYY-MM-DD or ISO when timeframe=custom (inclusive)
 *
 * Response:
 * {
 *   buckets: [
 *     {
 *       date: 'YYYY-MM-DD',
 *       bucket_start: 'YYYY-MM-DD',
 *       count: 12,
 *       by_user: [{ user_name: 'alice', count: 7 }, { user_name: 'bob', count: 5 }],
 *       by_project: [{ project_name: 'App A', count: 8 }, { project_name: 'App B', count: 4 }]
 *     }
 *   ],
 *   total: 123,
 *   meta: {
 *     timeframe: 'daily'|'weekly'|'monthly'|'custom',
 *     bucket_kind: 'day',
 *     window: { from: ISO, to: ISO }
 *   }
 * }
 */
router.get('/projects', async (req, res, next) => {
  try {
    const timeframe = String(req.query.timeframe || req.query.range || 'daily').toLowerCase();
    const customStart = req.query.start_date || req.query.from;
    const customEnd = req.query.end_date || req.query.to;

    // Always aggregate by day (UTC). timeframe only adjusts the window length.
    const now = new Date();
    let from, to;
    const startOfToday = startOfDayUTC(now);

    if (timeframe === 'weekly') {
      // last 7 days inclusive (UTC)
      from = addDaysUTC(startOfToday, -6);
      to = addDaysUTC(startOfToday, 1);
    } else if (timeframe === 'monthly') {
      // last 30 days inclusive (UTC)
      from = addDaysUTC(startOfToday, -29);
      to = addDaysUTC(startOfToday, 1);
    } else if (timeframe === 'custom') {
      if (!customStart || !customEnd) {
        return res.status(400).json({ success: false, message: 'start_date and end_date required when timeframe=custom' });
      }
      const s = isValidISODate(customStart) ? new Date(customStart) : parseISODateSafe(customStart);
      const e = isValidISODate(customEnd) ? new Date(customEnd) : parseISODateSafe(customEnd);
      if (s > e) {
        // swap
        from = startOfDayUTC(e);
        to = addDaysUTC(startOfDayUTC(s), 1);
      } else {
        from = startOfDayUTC(s);
        to = addDaysUTC(startOfDayUTC(e), 1); // inclusive end-date => +1 day
      }
    } else {
      // default daily => today only
      from = startOfDayUTC(now);
      to = addDaysUTC(from, 1);
    }

    const dbo = await getDb();
    const sessionCol = dbo.collection('session_tracking');

    // Build aggregation:
    // 1) Normalize dates from both collections
    // 2) Enforce project_id existence
    // 3) Match date windows on BOTH sides: _sessionCreatedAt and _deployCreatedAt
    // 4) Group by YYYY-MM-DD (UTC) from sessionCreatedAt as canonical day for counting
    // 5) For each day, compute per-user breakdown and optional per-project breakdown
    const pipeline = [
      // Normalize session-side createdAt
      {
        $addFields: {
          _sessionCreatedAt: {
            $ifNull: [
              '$created_at',
              { $ifNull: ['$session_start', { $ifNull: ['$last_updated', '$timestamp'] }] }
            ]
          }
        }
      },
      // Must have project_id to join
      { $match: { project_id: { $exists: true, $ne: null, $ne: '' } } },
      // Session date window
      { $match: { _sessionCreatedAt: { $gte: from, $lt: to } } },
      // Join deployments
      {
        $lookup: {
          from: 'app_deployments',
          localField: 'project_id',
          foreignField: 'project_id',
          as: 'deploys'
        }
      },
      { $unwind: { path: '$deploys', preserveNullAndEmptyArrays: false } },
      // Normalize deploy createdAt
      {
        $addFields: {
          _deployCreatedAt: {
            $ifNull: ['$deploys.created_at', '$deploys.updated_at']
          }
        }
      },
      // Deployment date window
      { $match: { _deployCreatedAt: { $gte: from, $lt: to } } },
      // Create daily bucket based on session date (UTC)
      {
        $addFields: {
          _bucketDay: { $dateToString: { format: '%Y-%m-%d', date: '$_sessionCreatedAt' } },
          _projectNameResolved: {
            $ifNull: ['$deploys.project_name', { $ifNull: ['$deploys.project.name', null] }]
          }
        }
      },
      // Group all details for the day to compute breakdowns
      {
        $group: {
          _id: '$_bucketDay',
          count: { $sum: 1 },
          users: { $push: '$user_name' },
          projects: { $push: '$_projectNameResolved' }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const rows = await sessionCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Build per-day user/project breakdown in JS for readability and stability
    const buckets = rows.map((r) => {
      const userCounts = new Map();
      for (const u of (r.users || [])) {
        const key = String(u || 'unknown');
        userCounts.set(key, (userCounts.get(key) || 0) + 1);
      }
      const by_user = Array.from(userCounts.entries())
        .map(([user_name, count]) => ({ user_name, count }))
        .sort((a, b) => b.count - a.count);

      const projCounts = new Map();
      for (const p of (r.projects || [])) {
        const key = p || 'unknown';
        projCounts.set(key, (projCounts.get(key) || 0) + 1);
      }
      const by_project = Array.from(projCounts.entries())
        .map(([project_name, count]) => ({ project_name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        date: r._id,
        bucket_start: r._id,
        count: r.count,
        by_user,
        by_project
      };
    });

    // Sum totals
    const total = buckets.reduce((acc, b) => acc + (b.count || 0), 0);

    // Response
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      buckets,
      total,
      meta: {
        timeframe,
        bucket_kind: 'day',
        window: { from: from.toISOString(), to: to.toISOString() }
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
