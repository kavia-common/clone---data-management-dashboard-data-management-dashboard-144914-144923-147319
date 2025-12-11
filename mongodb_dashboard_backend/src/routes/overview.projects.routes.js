'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { isValidISODate, parseISODateSafe, startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * GET /api/overview/projects
 * Aggregates "Total Projects" by joining session_tracking with app_deployments on project_id.
 * Supports timeframe=daily|weekly|monthly|custom and optional start_date/end_date (ISO or YYYY-MM-DD).
 * Applies date filter on created_at/timestamp fields in BOTH collections (session_tracking and app_deployments).
 * Only includes projects where both created_at fall within the selected range.
 *
 * Query:
 * - timeframe: 'daily' | 'weekly' | 'monthly' | 'custom' (default 'daily')
 * - start_date: ISO or YYYY-MM-DD when timeframe=custom (inclusive)
 * - end_date: ISO or YYYY-MM-DD when timeframe=custom (inclusive)
 *
 * Returns:
 * {
 *  buckets: [{ label, key, count }],
 *  total: number,
 *  byUser: [{ user_name, count }],
 *  projects: [{ project_id, project_name, user_name, created_at_session, created_at_deployment }]
 * }
 */
router.get('/projects', async (req, res, next) => {
  try {
    const timeframe = String(req.query.timeframe || req.query.range || 'daily').toLowerCase();
    const customStart = req.query.start_date || req.query.from;
    const customEnd = req.query.end_date || req.query.to;

    // Resolve date window
    const now = new Date();
    let from, to, granularity;
    const startOfToday = startOfDayUTC(now);

    if (timeframe === 'weekly') {
      // last 7 days (inclusive of today)
      from = addDaysUTC(startOfToday, -6);
      to = addDaysUTC(startOfToday, 1);
      granularity = 'day';
    } else if (timeframe === 'monthly') {
      // last 30 days
      from = addDaysUTC(startOfToday, -29);
      to = addDaysUTC(startOfToday, 1);
      granularity = 'day';
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
      // Determine granularity based on approximate span
      const spanDays = Math.max(1, Math.ceil((to - from) / (24 * 3600 * 1000)));
      granularity = spanDays <= 31 ? 'day' : spanDays <= 120 ? 'week' : 'month';
    } else {
      // default daily => today
      from = startOfDayUTC(now);
      to = addDaysUTC(from, 1);
      granularity = 'day';
    }

    const dbo = await getDb();

    // Prefer fields:
    // session side date: session_tracking.created_at || session_start || last_updated || timestamp
    // deployment side date: app_deployments.created_at || updated_at
    // We'll map them during aggregation
    const sessionCol = dbo.collection('session_tracking');
    const pipeline = [
      // Project normalized session date
      {
        $addFields: {
          _sessionCreatedAt: {
            $ifNull: ['$created_at',
              { $ifNull: ['$session_start',
                { $ifNull: ['$last_updated', '$timestamp'] }
              ] }
            ]
          }
        }
      },
      // Keep only those with a project_id available
      { $match: { project_id: { $exists: true, $ne: null, $ne: '' } } },
      // Date filter on session side
      {
        $match: {
          _sessionCreatedAt: { $gte: from, $lt: to }
        }
      },
      // Join deployments by project_id
      {
        $lookup: {
          from: 'app_deployments',
          localField: 'project_id',
          foreignField: 'project_id',
          as: 'deploys'
        }
      },
      { $unwind: { path: '$deploys', preserveNullAndEmptyArrays: false } },
      // Normalize deployment createdAt
      {
        $addFields: {
          _deployCreatedAt: {
            $ifNull: ['$deploys.created_at', '$deploys.updated_at']
          }
        }
      },
      // Date filter on deployment side
      {
        $match: {
          _deployCreatedAt: { $gte: from, $lt: to }
        }
      },
      // Build bucket key based on granularity
      {
        $addFields: {
          bucketKey: granularity === 'month'
            ? { $dateToString: { format: '%Y-%m', date: '$_sessionCreatedAt' } }
            : granularity === 'week'
              ? { $concat: [
                    { $dateToString: { format: '%G', date: '$_sessionCreatedAt' } }, '-W',
                    { $dateToString: { format: '%V', date: '$_sessionCreatedAt' } }
                ] }
              : { $dateToString: { format: '%Y-%m-%d', date: '$_sessionCreatedAt' } }
        }
      },
      // Group to build buckets and byUser and detail list
      {
        $group: {
          _id: '$bucketKey',
          count: { $sum: 1 },
          details: {
            $push: {
              project_id: '$project_id',
              user_name: '$user_name',
              project_name: {
                $ifNull: [
                  '$deploys.project_name',
                  { $ifNull: ['$deploys.project.name', null] }
                ]
              },
              created_at_session: '$_sessionCreatedAt',
              created_at_deployment: '$_deployCreatedAt'
            }
          },
          byUserMap: { $push: '$user_name' }
        }
      },
      // Sort by bucket ascending
      { $sort: { _id: 1 } }
    ];

    const bucketDocs = await sessionCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Transform results
    const buckets = bucketDocs.map((b) => ({
      key: b._id,
      label: b._id,
      count: b.count
    }));
    const total = buckets.reduce((acc, b) => acc + (b.count || 0), 0);

    // Collect byUser across all buckets
    const userCounts = new Map();
    for (const b of bucketDocs) {
      const users = Array.isArray(b.byUserMap) ? b.byUserMap : [];
      for (const u of users) {
        const key = String(u || 'unknown');
        userCounts.set(key, (userCounts.get(key) || 0) + 1);
      }
    }
    const byUser = Array.from(userCounts.entries())
      .map(([user_name, count]) => ({ user_name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Flatten details across buckets, with a reasonable cap to avoid huge payloads
    const projects = [];
    for (const b of bucketDocs) {
      for (const d of (b.details || [])) {
        projects.push({
          project_id: d.project_id,
          project_name: d.project_name,
          user_name: d.user_name,
          created_at_session: d.created_at_session,
          created_at_deployment: d.created_at_deployment
        });
        if (projects.length >= 2000) break;
      }
      if (projects.length >= 2000) break;
    }

    // Response
    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      buckets,
      total,
      byUser,
      projects,
      meta: {
        timeframe,
        granularity,
        window: { from: from.toISOString(), to: to.toISOString() }
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
