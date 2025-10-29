'use strict';

/**
 * Users Analytics Metrics Controller
 *
 * Implements user analytics endpoints:
 * - GET /api/users/analytics/daily-active?days=30
 * - GET /api/users/analytics/by-department?windowDays=14
 * - GET /api/users/analytics/active-vs-inactive?windowDays=14
 * - GET /api/users/analytics/top-active?limit=10&windowDays=30
 * - GET /api/users/analytics/summary
 *
 * Uses users collection fields: updated_at, created_at, department, organization_id, status, has_accepted_terms.
 * All date responses are ISO strings.
 */

const { getDb } = require('../config/db');

/**
 * Helpers
 */
const parsePositiveInt = (val, def) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
};

const now = () => new Date();

/**
 * Returns a date at UTC midnight for the provided date.
 */
const toUtcMidnight = (d) => {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
};

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/daily-active?days=30
 * Returns array of { date: YYYY-MM-DD, activeCount } for last N days based on updated_at activity.
 */
async function dailyActive(req, res, next) {
  try {
    const days = parsePositiveInt(req.query.days, 30);
    const db = await getDb();
    const users = db.collection('users');

    const end = now();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    // Aggregate by day on updated_at within the range
    const pipeline = [
      {
        $match: {
          updated_at: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            y: { $year: { date: '$updated_at' } },
            m: { $month: { date: '$updated_at' } },
            d: { $dayOfMonth: { date: '$updated_at' } },
          },
          activeCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          dateObj: {
            $dateFromParts: {
              'year': '$_id.y',
              'month': '$_id.m',
              'day': '$_id.d',
            },
          },
          activeCount: 1,
        },
      },
      { $sort: { dateObj: 1 } },
    ];

    const rows = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Fill gaps for days with zero activity
    const map = new Map(rows.map(r => [toUtcMidnight(r.dateObj).toISOString().slice(0, 10), r.activeCount]));
    const filled = [];
    let cursor = toUtcMidnight(start);
    const endMid = toUtcMidnight(end);
    while (cursor <= endMid) {
      const key = cursor.toISOString().slice(0, 10);
      filled.push({ date: key, activeCount: map.get(key) || 0 });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    res.json(filled);
  } catch (err) {
    next(err);
  }
}

/**
 * Determine "active window" start
 */
function windowStart(days) {
  return new Date(now().getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/by-department?windowDays=14
 * Returns [{ department, activeCount }] for users active in the recent window.
 */
async function byDepartment(req, res, next) {
  try {
    const windowDays = parsePositiveInt(req.query.windowDays, 14);
    const db = await getDb();
    const users = db.collection('users');
    const start = windowStart(windowDays);

    // Optional filters
    const { department, organization_id } = req.query || {};
    const match = { updated_at: { $gte: start } };
    if (department) {
      match.department = department;
    }
    if (organization_id) {
      match.organization_id = organization_id;
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ['$department', 'Unknown'] },
          activeCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          department: '$_id',
          activeCount: 1,
        },
      },
      { $sort: { activeCount: -1, department: 1 } },
    ];

    const items = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/active-vs-inactive?windowDays=14
 * Returns { active, inactive }
 * - active: users with updated_at within windowDays OR status explicitly "active"
 * - inactive: users outside that window AND not explicitly active status
 */
async function activeVsInactive(req, res, next) {
  try {
    const windowDays = parsePositiveInt(req.query.windowDays, 14);
    const db = await getDb();
    const users = db.collection('users');
    const start = windowStart(windowDays);

    const [
      totalCount,
      activeCountByUpdatedAt,
      activeStatusCount,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ updated_at: { $gte: start } }),
      users.countDocuments({ status: 'active' }),
    ]);

    // Union active criteria; approximate by summing and then subtract overlap:
    // Overlap: users that satisfy both conditions
    const overlap = await users.countDocuments({
      updated_at: { $gte: start },
      status: 'active',
    });
    const active = activeCountByUpdatedAt + activeStatusCount - overlap;
    const inactive = Math.max(0, totalCount - active);

    res.json({ active, inactive });
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/top-active?limit=10&windowDays=30
 * Returns top users by recent activity recency (updated_at) within window.
 * If multiple updates per user exist, we consider the most recent one via $group.
 */
async function topActive(req, res, next) {
  try {
    const limit = parsePositiveInt(req.query.limit, 10);
    const windowDays = parsePositiveInt(req.query.windowDays, 30);
    const db = await getDb();
    const users = db.collection('users');
    const start = windowStart(windowDays);

    const { department, organization_id } = req.query || {};
    const match = { updated_at: { $gte: start } };
    if (department) {
      match.department = department;
    }
    if (organization_id) {
      match.organization_id = organization_id;
    }

    const pipeline = [
      { $match: match },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          department: 1,
          organization_id: 1,
          updated_at: 1,
        },
      },
      { $sort: { updated_at: -1 } },
      { $limit: limit },
      {
        $project: {
          user_id: { $toString: '$_id' },
          name: 1,
          email: 1,
          department: 1,
          organization_id: 1,
          last_active_at: '$updated_at',
        },
      },
    ];

    const items = await users.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Ensure ISO
    const normalized = items.map((u) => ({
      ...u,
      last_active_at: u.last_active_at ? new Date(u.last_active_at).toISOString() : null,
    }));

    res.json(normalized);
  } catch (err) {
    next(err);
  }
}

/**
 * Compute WAU and MAU values using updated_at against windows of 7 and 30 days.
 */
async function computeWAU_MAU(usersCol) {
  const nowDt = now();
  const wauStart = new Date(nowDt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const mauStart = new Date(nowDt.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [WAU, MAU] = await Promise.all([
    usersCol.countDocuments({ updated_at: { $gte: wauStart } }),
    usersCol.countDocuments({ updated_at: { $gte: mauStart } }),
  ]);

  return { WAU, MAU };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/summary
 * Returns KPIs:
 * - totalActive: users with updated_at within last 14 days
 * - newUsersThisWeek: created_at within last 7 days
 * - inactive30Days: no updated_at in last 30 days OR status == 'inactive'
 * - compliancePct: has_accepted_terms true ratio
 * - WAU, MAU based on updated_at
 */
async function summary(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection('users');
    const nowDt = now();
    const activeWindowStart = new Date(nowDt.getTime() - 14 * 24 * 60 * 60 * 1000);
    const weekStart = new Date(nowDt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(nowDt.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      totalActive,
      newUsersThisWeek,
      inactiveByWindow,
      explicitlyInactive,
      complianceTrue,
    ] = await Promise.all([
      users.countDocuments({}),
      users.countDocuments({ updated_at: { $gte: activeWindowStart } }),
      users.countDocuments({ created_at: { $gte: weekStart } }),
      users.countDocuments({
        $or: [
          { updated_at: { $lt: monthStart } },
          { updated_at: { $exists: false } },
        ],
      }),
      users.countDocuments({ status: 'inactive' }),
      users.countDocuments({ has_accepted_terms: true }),
    ]);

    const inactive30Days = Math.min(totalUsers, inactiveByWindow + explicitlyInactive);
    const compliancePct = totalUsers > 0 ? +(100 * (complianceTrue / totalUsers)).toFixed(2) : 0;

    const { WAU, MAU } = await computeWAU_MAU(users);

    res.json({
      totalActive,
      newUsersThisWeek,
      inactive30Days,
      compliancePct,
      WAU,
      MAU,
      generatedAt: nowDt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * Ensure indexes for performance (idempotent).
 * Creates indexes on updated_at, created_at, department, organization_id.
 */
async function ensureUsersAnalyticsIndexes() {
  const db = await getDb();
  const users = db.collection('users');

  await Promise.all([
    users.createIndex({ updated_at: -1 }, { name: 'users_updated_at_desc' }),
    users.createIndex({ created_at: -1 }, { name: 'users_created_at_desc' }),
    users.createIndex({ department: 1 }, { name: 'users_department_asc' }),
    users.createIndex({ organization_id: 1 }, { name: 'users_org_asc' }),
  ]);
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/filters/departments
 * Returns array of distinct department values (strings), excluding null/empty.
 */
async function getDistinctDepartments(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection('users');
    const values = await users.distinct('department', { department: { $exists: true, $ne: null, $ne: '' } });
    // Normalize to strings and sort
    const items = values
      .map((v) => (v == null ? null : String(v)))
      .filter((v) => v && v.trim() !== '')
      .sort((a, b) => a.localeCompare(b));
    res.json(items);
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/analytics/filters/organizations
 * Returns array of distinct organization_id values (strings), excluding null/empty.
 */
async function getDistinctOrganizations(req, res, next) {
  try {
    const db = await getDb();
    const users = db.collection('users');
    const values = await users.distinct('organization_id', { organization_id: { $exists: true, $ne: null, $ne: '' } });
    const items = values
      .map((v) => (v == null ? null : String(v)))
      .filter((v) => v && v.trim() !== '')
      .sort((a, b) => a.localeCompare(b));
    res.json(items);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  dailyActive,
  byDepartment,
  activeVsInactive,
  topActive,
  summary,
  ensureUsersAnalyticsIndexes,
  getDistinctDepartments,
  getDistinctOrganizations,
};
