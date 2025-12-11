'use strict';

const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { isValidISODate, parseISODateSafe, startOfDayUTC, addDaysUTC } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * GET /api/overview/projects
 * Summary: Aggregates session_tracking by project_id within a selected timeframe, joins app_deployments to resolve project_name, and returns project buckets sorted by count desc.
 * Description:
 *  - Sources records from session_tracking based on created_at (with safe fallbacks to session_start/last_updated/timestamp).
 *  - Maintains organization_id/tenant_id filtering if provided (header x-organization-id has precedence).
 *  - Groups primarily by project_id (string normalized) and counts sessions.
 *  - Performs $lookup to app_deployments using $toString on both sides to handle ObjectId vs string for project_id.
 *  - If timeframe=daily or custom, also returns per-day breakdown per project (YYYY-MM-DD counts) in an optional 'days' array.
 *  - Results sorted by count desc.
 * Query Parameters:
 *  - timeframe|range: daily|weekly|monthly|custom (default daily)
 *  - start_date, end_date: required when timeframe=custom (YYYY-MM-DD or ISO). Inclusive of end_date.
 *  - organization_id|tenant_id: optional tenant scope
 * Success Response (200):
 * {
 *   "buckets": [
 *     {
 *       "project_id": "p1",
 *       "project_name": "My App",
 *       "count": 42,
 *       "days": [ { "date": "2025-01-02", "count": 3 }, ... ] // only for daily/custom ranges
 *     }
 *   ],
 *   "meta": { "timeframe": "daily", "window": { "from": "ISO", "to": "ISO" } }
 * }
 */
router.get('/projects', async (req, res, next) => {
  try {
    const timeframe = String(req.query.timeframe || req.query.range || 'daily').toLowerCase();
    const customStart = req.query.start_date || req.query.from;
    const customEnd = req.query.end_date || req.query.to;

    // Organization/tenant filter: header precedence, then query aliases
    const organizationId =
      req.headers['x-organization-id'] ||
      req.query.organization_id ||
      req.query.tenant_id ||
      req.query.org_id ||
      req.query.org ||
      null;

    // Compute time window in UTC
    const now = new Date();
    const startToday = startOfDayUTC(now);
    let from, to;
    if (timeframe === 'weekly') {
      from = addDaysUTC(startToday, -6);
      to = addDaysUTC(startToday, 1);
    } else if (timeframe === 'monthly') {
      from = addDaysUTC(startToday, -29);
      to = addDaysUTC(startToday, 1);
    } else if (timeframe === 'custom') {
      if (!customStart || !customEnd) {
        return res.status(400).json({ success: false, message: 'start_date and end_date required when timeframe=custom' });
      }
      const s = isValidISODate(customStart) ? new Date(customStart) : parseISODateSafe(customStart);
      const e = isValidISODate(customEnd) ? new Date(customEnd) : parseISODateSafe(customEnd);
      if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start_date or end_date' });
      }
      if (s > e) {
        from = startOfDayUTC(e);
        to = addDaysUTC(startOfDayUTC(s), 1);
      } else {
        from = startOfDayUTC(s);
        to = addDaysUTC(startOfDayUTC(e), 1);
      }
    } else {
      // daily default => today only
      from = startToday;
      to = addDaysUTC(startToday, 1);
    }

    const dbo = await getDb();
    const sessionCol = dbo.collection('session_tracking');

    // Build session match and normalization
    const sessionMatch = {
      _sessionCreatedAt: { $gte: from, $lt: to },
      _projectIdStr: { $exists: true, $ne: null, $ne: '' },
    };
    if (organizationId) {
      sessionMatch.$or = [
        { organization_id: organizationId },
        { tenant_id: organizationId },
      ];
    }

    // Aggregation pipeline
    const pipeline = [
      // 1) Normalize session timestamp and project id string
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
          },
        }
      },
      // 2) Time window and tenant filter
      { $match: sessionMatch },
      // 3) Day key for daily breakdown
      {
        $addFields: {
          _bucketDay: {
            $dateToString: { format: '%Y-%m-%d', date: '$_sessionCreatedAt' }
          }
        }
      },
      // 4) Group by project+day for breakdown
      {
        $group: {
          _id: { project_id: '$_projectIdStr', day: '$_bucketDay' },
          count: { $sum: 1 },
        }
      },
      // 5) Roll up to project with days[]
      {
        $group: {
          _id: '$_id.project_id',
          count: { $sum: '$count' },
          days: { $push: { date: '$_id.day', count: '$count' } },
        }
      },
      // 6) Lookup deployments for project_name; normalize project_id types
      {
        $lookup: {
          from: 'app_deployments',
          let: { joinProjectId: '$_id' },
          pipeline: [
            {
              $addFields: {
                _projectIdStr: {
                  $cond: [
                    { $eq: [{ $type: '$project_id' }, 'string'] },
                    '$project_id',
                    { $toString: '$project_id' }
                  ]
                }
              }
            },
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$_projectIdStr', '$$joinProjectId'] },
                    ...(organizationId
                      ? [
                          {
                            $or: [
                              { $eq: ['$organization_id', organizationId] },
                              { $eq: ['$tenant_id', organizationId] },
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
              }
            }
          ],
          as: 'deploys'
        }
      },
      // 7) Shape fields
      {
        $addFields: {
          project_id: '$_id',
          project_name: {
            $ifNull: [
              { $arrayElemAt: ['$deploys.project_name', 0] },
              { $arrayElemAt: ['$deploys.project.name', 0] }
            ]
          }
        }
      },
      // 8) Hide _id and remove days when not needed (keep here and drop later in code if needed)
      {
        $project: {
          _id: 0,
          deploys: 0,
          project_id: 1,
          project_name: 1,
          count: 1,
          days: 1
        }
      },
      // 9) Sort by count desc
      { $sort: { count: -1 } },
    ];

    const rows = await sessionCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Optionally remove days[] for non-daily ranges
    const includeDays = timeframe === 'daily' || timeframe === 'custom';
    const buckets = includeDays ? rows : rows.map(({ days, ...rest }) => rest);

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      buckets,
      meta: {
        timeframe,
        window: { from: from.toISOString(), to: to.toISOString() }
      }
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
