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
 *  - If timeframe=daily or custom, returns per-day breakdown per project (YYYY-MM-DD counts) in 'days'.
 *  - If timeframe=monthly, returns per-month breakdown per project (YYYY-MM counts) in 'months'.
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
 *       "days": [ { "date": "2025-01-02", "count": 3 }, ... ] // for daily/custom
 *       "months": [ { "month": "2025-01", "count": 12 }, ... ] // for monthly
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
      // past 7 days including today
      from = addDaysUTC(startToday, -6);
      to = addDaysUTC(startToday, 1);
    } else if (timeframe === 'monthly') {
      // past 30 days including today
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

    // Normalize and filter sessions: build match first for time + tenant (project filter is handled after computing _projectIdStr)
    const sessionMatch = {
      _sessionCreatedAt: { $gte: from, $lt: to },
    };
    if (organizationId) {
      sessionMatch.$or = [
        { organization_id: organizationId },
        { tenant_id: organizationId },
      ];
    }

    // Dynamic fields based on timeframe
    const bucketAddFields =
      timeframe === 'monthly'
        ? {
            // Monthly bucket key as YYYY-MM
            _bucketMonth: {
              $dateToString: {
                format: '%Y-%m',
                date: { $dateTrunc: { date: '$_sessionCreatedAt', unit: 'month' } },
              },
            },
          }
        : {
            // Daily bucket key as YYYY-MM-DD
            _bucketDay: {
              $dateToString: { format: '%Y-%m-%d', date: '$_sessionCreatedAt' },
            },
          };

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
            $switch: {
              branches: [
                {
                  case: { $eq: [{ $type: '$project_id' }, 'string'] },
                  then: '$project_id',
                },
                {
                  case: { $in: [{ $type: '$project_id' }, ['objectId', 'int', 'long', 'decimal', 'double']] },
                  then: { $toString: '$project_id' },
                },
              ],
              default: null,
            }
          },
        }
      },
      // 2) Time window and tenant filter
      { $match: sessionMatch },
      // 2b) Ensure we only include docs with a usable project id string; avoid nulls/empties
      { $match: { _projectIdStr: { $ne: null, $ne: '' } } },
      // 3) Add bucket key (day or month)
      { $addFields: bucketAddFields },
      // 4) Group with breakdown depending on timeframe
      ...(timeframe === 'monthly'
        ? [
            // group by project_id + month
            {
              $group: {
                _id: { project_id: '$_projectIdStr', month: '$_bucketMonth' },
                count: { $sum: 1 },
              }
            },
            // roll up to project with months[]
            {
              $group: {
                _id: '$_id.project_id',
                count: { $sum: '$count' },
                months: { $push: { month: '$_id.month', count: '$count' } },
              }
            },
          ]
        : [
            // group by project_id + day
            {
              $group: {
                _id: { project_id: '$_projectIdStr', day: '$_bucketDay' },
                count: { $sum: 1 },
              }
            },
            // roll up to project with days[]
            {
              $group: {
                _id: '$_id.project_id',
                count: { $sum: '$count' },
                days: { $push: { date: '$_id.day', count: '$count' } },
              }
            },
          ]),
      // 5) Lookup deployments for project_name; normalize project_id types and filter by tenant if provided
      {
        $lookup: {
          from: 'app_deployments',
          let: { joinProjectId: '$_id' },
          pipeline: [
            {
              $addFields: {
                _projectIdStr: {
                  $switch: {
                    branches: [
                      { case: { $eq: [{ $type: '$project_id' }, 'string'] }, then: '$project_id' },
                      {
                        case: { $in: [{ $type: '$project_id' }, ['objectId', 'int', 'long', 'decimal', 'double']] },
                        then: { $toString: '$project_id' },
                      },
                    ],
                    default: null,
                  }
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
      // 6) Shape fields
      {
        $addFields: {
          project_id: '$_id',
          project_name: {
            $let: {
              vars: {
                p1: { $arrayElemAt: ['$deploys.project_name', 0] },
                p2: { $arrayElemAt: ['$deploys.project.name', 0] },
              },
              in: { $ifNull: ['$$p1', '$$p2'] }
            }
          }
        }
      },
      // 7) Final projection including days or months depending on timeframe
      {
        $project: {
          _id: 0,
          deploys: 0,
          project_id: 1,
          project_name: 1,
          count: 1,
          days: timeframe === 'monthly' ? 0 : 1,
          months: timeframe === 'monthly' ? 1 : 0,
        }
      },
      // 8) Sort by count desc
      { $sort: { count: -1 } },
    ];

    const rows = await sessionCol.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Shape response buckets for stable ordering in nested arrays
    let buckets;
    if (timeframe === 'monthly') {
      buckets = rows.map((r) => {
        const months = Array.isArray(r.months)
          ? [...r.months].filter(m => m && m.month).sort((a, b) => String(a.month).localeCompare(String(b.month)))
          : [];
        return {
          project_id: r.project_id || r.projectId || r._id || null,
          project_name: r.project_name || null,
          count: r.count || 0,
          months,
        };
      });
    } else {
      const includeDays = timeframe === 'daily' || timeframe === 'custom';
      buckets = rows.map((r) => {
        const out = {
          project_id: r.project_id || r.projectId || r._id || null,
          project_name: r.project_name || null,
          count: r.count || 0,
        };
        if (includeDays) {
          out.days = Array.isArray(r.days)
            ? [...r.days].filter(d => d && d.date).sort((a, b) => String(a.date).localeCompare(String(b.date)))
            : [];
        }
        return out;
      });
    }

    res.set('Cache-Control', 'no-store');
    return res.status(200).json({
      buckets,
      meta: {
        timeframe,
        window: { from: from.toISOString(), to: to.toISOString() }
      }
    });
  } catch (err) {
    // Robust error handling; delegate to global error handler
    return next(err);
  }
});

module.exports = router;
