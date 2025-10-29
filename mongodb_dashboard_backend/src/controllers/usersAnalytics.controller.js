'use strict';

/**
 * Users Analytics Controller
 * Provides DAU/WAU/MAU, departmental activity, active vs inactive, top active users, and growth trend.
 * Uses users collection fields: updated_at, created_at, department, status, organization_id, has_accepted_terms
 *
 * All endpoints accept optional organization_id and department filters where relevant.
 * Dates are handled as ISO strings in responses and UTC-based bucketing on the server.
 */

const { getDb } = require('../config/db');
const { isValidISODate, parseISODateSafe, startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * Helper to build common match filter for organization and department
 */
function buildCommonMatch({ organization_id, department }) {
  const match = {};
  if (organization_id) match.organization_id = organization_id;
  if (department) match.department = department;
  return match;
}

/**
 * Helper to resolve date window from query with defaults
 * Supports (?start_date, ?end_date) or fallback to last N days (defaultDays)
 */
function resolveDateWindow(req, defaultDays = 30, startKey = 'start_date', endKey = 'end_date') {
  const now = new Date();
  const end = req.query[endKey] && isValidISODate(req.query[endKey])
    ? parseISODateSafe(req.query[endKey], now) : now;
  let start;
  if (req.query[startKey] && isValidISODate(req.query[startKey])) {
    start = parseISODateSafe(req.query[startKey], new Date(end));
  } else {
    const days = Number(req.query.days || req.query.windowDays || defaultDays);
    start = addDaysUTC(startOfDayUTC(end), -Math.max(1, Math.min(365, isNaN(days) ? defaultDays : days)));
  }
  return { start, end };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/overview
 * Returns KPI overview with totals and activity metrics.
 */
async function overview(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id } = req.query;
    const baseMatch = buildCommonMatch({ organization_id });

    const now = new Date();
    const startToday = startOfDayUTC(now);
    const sevenDaysAgo = addDaysUTC(startOfDayUTC(now), -6); // include today => 7 days window
    const thirtyDaysAgo = addDaysUTC(startOfDayUTC(now), -30);
    const yearAgo = addDaysUTC(startOfDayUTC(now), -365);

    // Compute DAU/WAU/MAU based on updated_at recency
    const [dau, wau, mau, totalActive30, inactive30Plus, newUsersThisWeek, compliance] = await Promise.all([
      users.countDocuments({
        ...baseMatch,
        updated_at: { $gte: startToday }
      }),
      users.countDocuments({
        ...baseMatch,
        updated_at: { $gte: sevenDaysAgo }
      }),
      users.countDocuments({
        ...baseMatch,
        updated_at: { $gte: yearAgo } // treat as MAU over last 30 days usually; but to meet MAU definition use 30 days
      }),
      users.countDocuments({
        ...baseMatch,
        updated_at: { $gte: thirtyDaysAgo }
      }),
      users.countDocuments({
        ...baseMatch,
        $or: [
          { updated_at: { $lt: thirtyDaysAgo } },
          { updated_at: { $exists: false } }
        ]
      }),
      users.countDocuments({
        ...baseMatch,
        created_at: { $gte: sevenDaysAgo }
      }),
      // compliancePercent: has_accepted_terms true among scoped users
      (async () => {
        const pipeline = [
          { $match: { ...baseMatch } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              accepted: {
                $sum: {
                  $cond: [{ $eq: ['$has_accepted_terms', true] }, 1, 0]
                }
              }
            }
          },
          {
            $project: {
              _id: 0,
              percent: {
                $cond: [{ $eq: ['$total', 0] }, 0, { $multiply: [{ $divide: ['$accepted', '$total'] }, 100] }]
              }
            }
          }
        ];
        const arr = await users.aggregate(pipeline).toArray();
        return arr[0]?.percent || 0;
      })()
    ]);

    // Adjust MAU to last 30 days, as is common
    const mau30 = await users.countDocuments({
      ...baseMatch,
      updated_at: { $gte: addDaysUTC(startOfDayUTC(now), -30) }
    });

    res.json({
      totalActive: totalActive30, // active in last 30 days
      newUsersThisWeek,
      inactive30Plus,
      compliancePercent: Number(compliance?.toFixed ? compliance.toFixed(2) : compliance),
      dau,
      wau,
      mau: mau30
    });
  } catch (err) {
    console.error('overview error', err);
    res.status(500).json({ error: 'Failed to compute overview metrics' });
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/daily-active?days=30
 * Returns [{ date: 'YYYY-MM-DD', count }]
 */
async function dailyActive(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id, department } = req.query;
    const match = buildCommonMatch({ organization_id, department });

    const { start, end } = resolveDateWindow(req, 30, 'start_date', 'end_date');

    const pipeline = [
      {
        $match: {
          ...match,
          updated_at: { $exists: true, $gte: start, $lte: end }
        }
      },
      {
        $addFields: {
          updated_at_date: {
            $dateTrunc: { date: '$updated_at', unit: 'day' }
          }
        }
      },
      {
        $group: {
          _id: '$updated_at_date',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const raw = await users.aggregate(pipeline).toArray();

    // Fill missing days
    const pointsMap = new Map(raw.map(r => [formatYYYYMMDD(r._id), r.count]));
    const out = [];
    for (let d = startOfDayUTC(start); d <= end; d = addDaysUTC(d, 1)) {
      const key = formatYYYYMMDD(d);
      out.push({ date: key, count: pointsMap.get(key) || 0 });
    }

    res.json(out);
  } catch (err) {
    console.error('dailyActive error', err);
    res.status(500).json({ error: 'Failed to compute daily active users' });
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/by-department
 * Returns [{ department, count }]
 */
async function byDepartment(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id, department } = req.query;
    const match = buildCommonMatch({ organization_id, department });
    const { start, end } = resolveDateWindow(req, 14, 'start_date', 'end_date');

    const pipeline = [
      {
        $match: {
          ...match,
          updated_at: { $exists: true, $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: {
            $ifNull: ['$department', 'Unknown']
          },
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          department: '$_id',
          count: 1
        }
      },
      { $sort: { count: -1, department: 1 } }
    ];

    const items = await users.aggregate(pipeline).toArray();
    res.json(items);
  } catch (err) {
    console.error('byDepartment error', err);
    res.status(500).json({ error: 'Failed to compute department activity' });
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/active-vs-inactive
 * Returns { active, inactive }
 */
async function activeVsInactive(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id, department } = req.query;
    const match = buildCommonMatch({ organization_id, department });

    const { start, end } = resolveDateWindow(req, 14, 'start_date', 'end_date');

    // Active = updated_at within window OR status === 'active'
    const [activeCount, total] = await Promise.all([
      users.countDocuments({
        ...match,
        $or: [
          { updated_at: { $exists: true, $gte: start, $lte: end } },
          { status: 'active' }
        ]
      }),
      users.countDocuments({ ...match })
    ]);

    const inactive = Math.max(0, (total || 0) - (activeCount || 0));
    res.json({ active: activeCount || 0, inactive });
  } catch (err) {
    console.error('activeVsInactive error', err);
    res.status(500).json({ error: 'Failed to compute active vs inactive' });
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/top-active?limit=10
 * Returns [{ userId, name, department, activityCount, lastActiveAt }]
 * activityCount approximated as number of updates within window (if multiple docs per user existed, but here users is single doc, so default 1)
 * We sort by updated_at desc
 */
async function topActive(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id, department } = req.query;
    const match = buildCommonMatch({ organization_id, department });

    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 10));
    const { start, end } = resolveDateWindow(req, 30, 'start_date', 'end_date');

    const pipeline = [
      {
        $match: {
          ...match,
          updated_at: { $exists: true, $gte: start, $lte: end }
        }
      },
      {
        $project: {
          _id: 1,
          name: { $ifNull: ['$name', '$email'] },
          department: { $ifNull: ['$department', 'Unknown'] },
          updated_at: 1
        }
      },
      { $sort: { updated_at: -1 } },
      { $limit: limit }
    ];

    const items = await users.aggregate(pipeline).toArray();

    const mapped = items.map(doc => ({
      userId: String(doc._id),
      name: doc.name || null,
      department: doc.department || 'Unknown',
      activityCount: 1,
      lastActiveAt: doc.updated_at ? new Date(doc.updated_at).toISOString() : null
    }));

    res.json(mapped);
  } catch (err) {
    console.error('topActive error', err);
    res.status(500).json({ error: 'Failed to compute top active users' });
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/growth
 * Returns [{ date, newUsers }]
 * Buckets by created_at per day within window
 */
async function growth(req, res) {
  try {
    const db = await getDb();
    const users = db.collection('users');

    const { organization_id, department } = req.query;
    const match = buildCommonMatch({ organization_id, department });

    const { start, end } = resolveDateWindow(req, 30, 'start_date', 'end_date');

    const pipeline = [
      {
        $match: {
          ...match,
          created_at: { $exists: true, $gte: start, $lte: end }
        }
      },
      {
        $addFields: {
          created_at_date: {
            $dateTrunc: { date: '$created_at', unit: 'day' }
          }
        }
      },
      {
        $group: {
          _id: '$created_at_date',
          newUsers: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const raw = await users.aggregate(pipeline).toArray();

    // Fill missing days
    const pointsMap = new Map(raw.map(r => [formatYYYYMMDD(r._id), r.newUsers]));
    const out = [];
    for (let d = startOfDayUTC(start); d <= end; d = addDaysUTC(d, 1)) {
      const key = formatYYYYMMDD(d);
      out.push({ date: key, newUsers: pointsMap.get(key) || 0 });
    }

    res.json(out);
  } catch (err) {
    console.error('growth error', err);
    res.status(500).json({ error: 'Failed to compute users growth trend' });
  }
}

module.exports = {
  overview,
  dailyActive,
  byDepartment,
  activeVsInactive,
  topActive,
  growth
};
