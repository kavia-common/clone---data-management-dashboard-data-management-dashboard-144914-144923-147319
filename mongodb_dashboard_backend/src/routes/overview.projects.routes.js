'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { isValidISODate, parseISODateSafe, startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * GET /api/overview/projects
 * Summary: Time-bucketed (day) counts of projects derived by joining session_tracking and app_deployments on project_id.
 * Description:
 *  - Applies UTC date range window to both collections (created_at/updated_at normalization).
 *  - Groups by YYYY-MM-DD (UTC) using session-side dates.
 *  - Returns stable fields: { date, bucket_start, count, by_user, by_project } sorted by bucket_start ascending.
 *  - Adds guards for missing user_name/project_name as 'unknown'.
 * Query Parameters:
 *  - timeframe: daily|weekly|monthly|custom (default daily)
 *  - start_date: YYYY-MM-DD or ISO (required when timeframe=custom; inclusive)
 *  - end_date: YYYY-MM-DD or ISO (required when timeframe=custom; inclusive)
 *  - organization_id|tenant_id (optional): tenant scoping filter applied consistently across both collections
 * Success Response (200):
 * {
 *   "buckets": [
 *     { "date": "YYYY-MM-DD", "bucket_start": "YYYY-MM-DD", "count": 12,
 *       "by_user": [{ "user_name": "alice", "count": 7 }],
 *       "by_project": [{ "project_name": "App A", "count": 8 }]
 *     }
 *   ],
 *   "total": 123,
 *   "meta": { "timeframe": "daily|weekly|monthly|custom", "bucket_kind": "day",
 *     "window": { "from": "ISO", "to": "ISO" } }
 * }
 */
router.get('/projects', async (req, res, next) => {
  try {
    const timeframe = String(req.query.timeframe || req.query.range || 'daily').toLowerCase();
    const customStart = req.query.start_date || req.query.from;
    const customEnd = req.query.end_date || req.query.to;

    // Organization/tenant filter: use header first, then query aliases
    const organizationId =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id ||
      req.query.org_id ||
      req.query.org;

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

    // Build deployment match for $lookup with pipeline to ensure matching types and tenant scope
    // Normalize project_id to string for join and ensure tenant/organization filters apply consistently
    const deploymentLookup = {
      from: 'app_deployments',
      let: { joinProjectId: { $toString: '$project_id' } },
      pipeline: [
        {
          $addFields: {
            _projectIdStr: {
              $cond: [
                { $eq: [{ $type: '$project_id' }, 'string'] },
                '$project_id',
                { $toString: '$project_id' }
              ]
            },
            _deployCreatedAt: { $ifNull: ['$created_at', '$updated_at'] }
          }
        },
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$_projectIdStr', '$$joinProjectId'] },
                { $gte: ['$_deployCreatedAt', from] },
                { $lt: ['$_deployCreatedAt', to] },
                // Tenant/organization filter if provided
                ...(organizationId
                  ? [
                      {
                        $or: [
                          { $eq: ['$organization_id', organizationId] },
                          { $eq: ['$tenant_id', organizationId] }
                        ]
                      }
                    ]
                  : [])
              ]
            }
          }
        },
        {
          $project: {
            project_name: 1,
            'project.name': 1,
            _deployCreatedAt: 1,
            organization_id: 1,
            tenant_id: 1,
            project_id: 1
          }
        }
      ],
      as: 'deploys'
    };

    // Build aggregation:
    // 1) Normalize dates from session_tracking
    // 2) Enforce project_id existence and normalize to string
    // 3) Match date window on session side
    // 4) Apply tenant filter on session side as well
    // 5) Join app_deployments with pipeline ensuring matching types and date window
    // 6) Create UTC daily bucket and compute breakdowns
    const pipeline = [
      {
        $addFields: {
          _sessionCreatedAt: {
            $ifNull: [
              '$created_at',
              { $ifNull: ['$session_start', { $ifNull: ['$last_updated', '$timestamp'] }] }
            ]
          },
          _projectIdStr: {
            $cond: [
              { $eq: [{ $type: '$project_id' }, 'string'] },
              '$project_id',
              { $toString: '$project_id' }
            ]
          }
        }
      },
      { $match: { _sessionCreatedAt: { $gte: from, $lt: to } } },
      // Must have project_id to join
      { $match: { _projectIdStr: { $exists: true, $ne: null, $ne: '' } } },
      // Tenant/organization filter on session side when provided
      ...(organizationId
        ? [
            {
              $match: {
                $or: [
                  { organization_id: organizationId },
                  { tenant_id: organizationId }
                ]
              }
            }
          ]
        : []),
      // Lookup deployments with date window and tenant match
      { $lookup: deploymentLookup },
      // keep only those with at least one matching deployment within window (inner join behavior)
      { $unwind: { path: '$deploys', preserveNullAndEmptyArrays: false } },
      // Bucket day based on session date (UTC)
      {
        $addFields: {
          _bucketDay: {
            $dateToString: { format: '%Y-%m-%d', date: '$_sessionCreatedAt' }
          },
          _projectNameResolved: {
            $ifNull: ['$deploys.project_name', { $ifNull: ['$deploys.project.name', 'unknown'] }]
          },
          _userNameResolved: { $ifNull: ['$user_name', 'unknown'] }
        }
      },
      // Group all details for the day to compute breakdowns
      {
        $group: {
          _id: '$_bucketDay',
          count: { $sum: 1 },
          users: { $push: '$_userNameResolved' },
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
