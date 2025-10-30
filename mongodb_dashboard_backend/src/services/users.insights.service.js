'use strict';

/**
 * UsersInsightsService
 * Aggregation-based analytics for user insights. Prefers session/activity collections for activity;
 * falls back to users.updated_at / accepted_terms_at when no dedicated session/activity exists.
 *
 * PUBLIC INTERFACE methods return objects structured for visualization:
 * { totals, items: [...], meta: { from, to, granularity } }
 */

const { startOfDay, endOfDay, subDays, subWeeks, subMonths } = require('date-fns');

function getDb() {
  // Lazy require to avoid circulars in tests
  const { getDb } = require('../config/db');
  return getDb();
}

function coerceDate(value, def) {
  if (!value) return def;
  const d = new Date(value);
  return isNaN(d.getTime()) ? def : d;
}

function normalizeGranularity(granularity, allowed = ['day', 'week', 'month']) {
  const g = (granularity || 'day').toLowerCase();
  return allowed.includes(g) ? g : allowed[0];
}

function getTimeWindowForPeriod(period) {
  const now = new Date();
  const todayStart = startOfDay(now);
  switch ((period || 'daily').toLowerCase()) {
    case 'daily':
      return { from: todayStart, to: endOfDay(now), granularity: 'day' };
    case 'weekly': {
      const from = subWeeks(todayStart, 1);
      return { from, to: now, granularity: 'day' };
    }
    case 'monthly': {
      const from = subMonths(todayStart, 1);
      return { from, to: now, granularity: 'day' };
    }
    default:
      return { from: subDays(todayStart, 1), to: now, granularity: 'day' };
  }
}

async function collectionExists(db, name) {
  const cols = await db.listCollections({ name }).toArray();
  return !!cols.length;
}

function buildSessionTimeField() {
  // Prefer last_updated, then session_end, else session_start
  return {
    $ifNull: [
      '$last_updated',
      { $ifNull: ['$session_end', '$session_start'] },
    ],
  };
}

function dateBucketStage(granularity, dateExpr) {
  // Use $dateTrunc on MongoDB 5.0+; fallback to $dateToString for 'day'
  if (granularity === 'day') {
    return {
      $dateToString: { date: dateExpr, format: '%Y-%m-%d' },
    };
  }
  if (granularity === 'week') {
    return {
      $dateToString: { date: dateExpr, format: '%G-%V' }, // ISO week-year-week
    };
  }
  if (granularity === 'month') {
    return {
      $dateToString: { date: dateExpr, format: '%Y-%m' },
    };
  }
  return {
    $dateToString: { date: dateExpr, format: '%Y-%m-%d' },
  };
}

function fillSeriesBuckets(items, from, to, granularity) {
  // Only fill for day granularity for simplicity and current needs (30-day series)
  if (granularity !== 'day') return items;
  const map = new Map(items.map(it => [it.date, it]));
  const cursor = startOfDay(from);
  const end = endOfDay(to);
  const filled = [];
  let d = new Date(cursor);
  while (d <= end) {
    const label = d.toISOString().slice(0, 10);
    const found = map.get(label);
    filled.push(found || { date: label, total: 0, sessions: 0 });
    d = subDays(d, -1); // add one day
  }
  return filled;
}

async function inferActivesFromUsers(db, from, to) {
  // Fallback heuristic: updated_at or accepted_terms_at within window
  const usersCol = db.collection('users');
  const match = {
    $or: [
      { updated_at: { $gte: from, $lte: to } },
      { accepted_terms_at: { $gte: from, $lte: to } },
      { created_at: { $gte: from, $lte: to } },
    ],
  };
  const total = await usersCol.distinct('_id', match);
  return total.length;
}

async function activeUsersCount(db, from, to, opts = {}) {
  const hasSessions = await collectionExists(db, 'session_tracking');
  if (hasSessions) {
    const col = db.collection('session_tracking');
    const statusFilter = opts.status
      ? { status: { $in: String(opts.status).split('|') } }
      : { status: { $in: ['completed', 'active'] } };

    const match = {
      ...statusFilter,
    };
    const timeExpr = buildSessionTimeField();
    match.$expr = {
      $and: [
        { $gte: [timeExpr, from] },
        { $lte: [timeExpr, to] },
      ],
    };
    if (opts.tenant_id) match.tenant_id = opts.tenant_id;

    const result = await col
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: '$user_id',
          },
        },
        { $count: 'total' },
      ])
      .toArray();

    return result.length ? result[0].total : 0;
  }
  return inferActivesFromUsers(db, from, to);
}

// PUBLIC_INTERFACE
async function getActivitySummary({ period }) {
  /** Returns total active users for a selected period (daily|weekly|monthly). */
  const db = getDb();
  const { from, to, granularity } = getTimeWindowForPeriod(period);
  const total = await activeUsersCount(db, from, to);
  return {
    totals: { activeUsers: total },
    items: [{ label: period || 'daily', count: total }],
    meta: { from, to, granularity },
  };
}

// PUBLIC_INTERFACE
async function getActiveUsersTrend({ from, to }) {
  /** 30-day active users trend with daily buckets. */
  const db = getDb();
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 30));
  const hasSessions = await collectionExists(db, 'session_tracking');

  if (hasSessions) {
    const col = db.collection('session_tracking');
    const timeExpr = buildSessionTimeField();
    const statusFilter = { status: { $in: ['completed', 'active'] } };
    const result = await col
      .aggregate([
        {
          $match: {
            ...statusFilter,
            $expr: {
              $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
            },
          },
        },
        {
          $group: {
            _id: {
              date: buildSessionTimeField(),
              user_id: '$user_id',
            },
          },
        },
        {
          $project: {
            date: buildSessionTimeField(),
          },
        },
        {
          $group: {
            _id: {
              date: dateBucketStage('day', '$date'),
            },
            total: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id.date',
            total: 1,
          },
        },
        { $sort: { date: 1 } },
      ])
      .toArray();

    const items = fillSeriesBuckets(result, start, end, 'day');
    return {
      totals: { points: items.length },
      items,
      meta: { from: start, to: end, granularity: 'day' },
    };
  }

  // Fallback via users heuristics: group by day using updated_at/accepted_terms_at/created_at
  const usersCol = db.collection('users');
  const result = await usersCol
    .aggregate([
      {
        $match: {
          $or: [
            { updated_at: { $gte: start, $lte: end } },
            { accepted_terms_at: { $gte: start, $lte: end } },
            { created_at: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $project: {
          activity_date: {
            $ifNull: [
              '$updated_at',
              { $ifNull: ['$accepted_terms_at', '$created_at'] },
            ],
          },
          _id: 1,
        },
      },
      {
        $group: {
          _id: {
            date: {
              $dateToString: { date: '$activity_date', format: '%Y-%m-%d' },
            },
            user_id: '$_id',
          },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          total: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          total: 1,
        },
      },
      { $sort: { date: 1 } },
    ])
    .toArray();

  const items = fillSeriesBuckets(result, start, end, 'day');
  return {
    totals: { points: items.length },
    items,
    meta: { from: start, to: end, granularity: 'day' },
  };
}

// PUBLIC_INTERFACE
async function getByOrganization({ from, to }) {
  /** Active users grouped by organization_id. */
  const db = getDb();
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 30));
  const hasSessions = await collectionExists(db, 'session_tracking');

  if (hasSessions) {
    const col = db.collection('session_tracking');
    const timeExpr = buildSessionTimeField();
    const result = await col
      .aggregate([
        {
          $match: {
            $expr: {
              $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
            },
          },
        },
        {
          $group: {
            _id: { org: '$tenant_id', user_id: '$user_id' },
          },
        },
        {
          $group: {
            _id: '$_id.org',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            organization_id: '$_id',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    return {
      totals: { groups: result.length },
      items: result.map(r => ({ label: r.organization_id || 'Unknown', count: r.count })),
      meta: { from: start, to: end, granularity: 'group' },
    };
  }

  // Fallback via users
  const usersCol = db.collection('users');
  const result = await usersCol
    .aggregate([
      {
        $match: {
          $or: [
            { updated_at: { $gte: start, $lte: end } },
            { accepted_terms_at: { $gte: start, $lte: end } },
            { created_at: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $group: {
          _id: '$organization_id',
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          organization_id: '$_id',
          count: 1,
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return {
    totals: { groups: result.length },
    items: result.map(r => ({ label: r.organization_id || 'Unknown', count: r.count })),
    meta: { from: start, to: end, granularity: 'group' },
  };
}

// PUBLIC_INTERFACE
async function getByDepartment({ from, to }) {
  /** Active users grouped by department (fallback to profile.department or 'Unknown'). */
  const db = getDb();
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 30));
  const usersCol = db.collection('users');

  // We join distinct active user_ids from sessions (if exists) to users for department
  const hasSessions = await collectionExists(db, 'session_tracking');
  if (hasSessions) {
    const st = db.collection('session_tracking');
    const timeExpr = buildSessionTimeField();
    const activeUsers = await st
      .aggregate([
        {
          $match: {
            $expr: {
              $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
            },
          },
        },
        { $group: { _id: '$user_id' } },
      ])
      .toArray();
    const userIds = activeUsers.map(x => x._id);

    if (!userIds.length) {
      return {
        totals: { groups: 0 },
        items: [],
        meta: { from: start, to: end, granularity: 'group' },
      };
    }

    const result = await usersCol
      .aggregate([
        { $match: { _id: { $in: userIds } } },
        {
          $project: {
            dept: {
              $ifNull: [
                '$department',
                { $ifNull: ['$profile.department', 'Unknown'] },
              ],
            },
          },
        },
        {
          $group: {
            _id: '$dept',
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            department: '$_id',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    return {
      totals: { groups: result.length },
      items: result.map(r => ({ label: r.department || 'Unknown', count: r.count })),
      meta: { from: start, to: end, granularity: 'group' },
    };
  }

  // Fallback: group users by department within date heuristic
  const result = await usersCol
    .aggregate([
      {
        $match: {
          $or: [
            { updated_at: { $gte: start, $lte: end } },
            { accepted_terms_at: { $gte: start, $lte: end } },
            { created_at: { $gte: start, $lte: end } },
          ],
        },
      },
      {
        $project: {
          dept: {
            $ifNull: [
              '$department',
              { $ifNull: ['$profile.department', 'Unknown'] },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$dept',
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          department: '$_id',
          count: 1,
        },
      },
      { $sort: { count: -1 } },
    ])
    .toArray();

  return {
    totals: { groups: result.length },
    items: result.map(r => ({ label: r.department || 'Unknown', count: r.count })),
    meta: { from: start, to: end, granularity: 'group' },
  };
}

// PUBLIC_INTERFACE
async function getCompliance({ from, to }) {
  /** Terms acceptance totals/rates; optionally MFA/inactivity if fields exist. */
  const db = getDb();
  const usersCol = db.collection('users');
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 365));

  const totalUsers = await usersCol.countDocuments({});
  const acceptedCount = await usersCol.countDocuments({
    has_accepted_terms: true,
  });
  const acceptedWithinWindow = await usersCol.countDocuments({
    has_accepted_terms: true,
    accepted_terms_at: { $gte: start, $lte: end },
  });

  // Optional checks
  let mfaEnabledCount = null;
  let inactiveCount = null;

  // Attempt to detect MFA field existence using a sample
  const sample = await usersCol.findOne({}, { projection: { mfa_enabled: 1, last_login_at: 1 } });
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'mfa_enabled')) {
    mfaEnabledCount = await usersCol.countDocuments({ mfa_enabled: true });
  }
  if (sample && Object.prototype.hasOwnProperty.call(sample, 'last_login_at')) {
    const inactiveThreshold = subDays(end, 30);
    inactiveCount = await usersCol.countDocuments({
      $or: [
        { last_login_at: { $exists: false } },
        { last_login_at: { $lt: inactiveThreshold } },
      ],
    });
  }

  const acceptanceRate = totalUsers ? acceptedCount / totalUsers : 0;

  return {
    totals: {
      totalUsers,
      accepted: acceptedCount,
      acceptedWithinWindow,
      acceptanceRate,
      mfaEnabled: mfaEnabledCount,
      inactiveUsers30d: inactiveCount,
    },
    items: [
      { label: 'Accepted Terms', count: acceptedCount },
      { label: 'Not Accepted', count: totalUsers - acceptedCount },
    ],
    meta: { from: start, to: end, granularity: 'summary' },
  };
}

// PUBLIC_INTERFACE
async function getEngagementTrend({ from, to, granularity }) {
  /** Time series of distinct active users and sessions by granularity (day|week|month). */
  const db = getDb();
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 30));
  const g = normalizeGranularity(granularity, ['day', 'week', 'month']);
  const hasSessions = await collectionExists(db, 'session_tracking');

  if (!hasSessions) {
    // Basic fallback: only active users via heuristic, sessions unknown
    const usersCol = db.collection('users');
    const result = await usersCol
      .aggregate([
        {
          $match: {
            $or: [
              { updated_at: { $gte: start, $lte: end } },
              { accepted_terms_at: { $gte: start, $lte: end } },
              { created_at: { $gte: start, $lte: end } },
            ],
          },
        },
        {
          $project: {
            d: {
              $ifNull: [
                '$updated_at',
                { $ifNull: ['$accepted_terms_at', '$created_at'] },
              ],
            },
            _id: 1,
          },
        },
        {
          $group: {
            _id: {
              bucket: dateBucketStage('day', '$d'),
              user_id: '$_id',
            },
          },
        },
        {
          $group: {
            _id: '$_id.bucket',
            users: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            users: 1,
            sessions: { $literal: 0 },
          },
        },
        { $sort: { date: 1 } },
      ])
      .toArray();

    const items = fillSeriesBuckets(
      result.map(r => ({ date: r.date, total: r.users, sessions: r.sessions })),
      start,
      end,
      'day'
    );

    return {
      totals: { points: items.length },
      items,
      meta: { from: start, to: end, granularity: 'day' },
    };
  }

  const col = db.collection('session_tracking');
  const timeExpr = buildSessionTimeField();
  const result = await col
    .aggregate([
      {
        $match: {
          $expr: {
            $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
          },
        },
      },
      // Compute bucket label
      {
        $addFields: {
          bucket: dateBucketStage(g, timeExpr),
        },
      },
      // Sessions per bucket
      {
        $group: {
          _id: '$bucket',
          sessions: { $sum: 1 },
          usersSet: { $addToSet: '$user_id' },
        },
      },
      {
        $project: {
          _id: 0,
          date: '$_id',
          sessions: 1,
          users: { $size: '$usersSet' },
        },
      },
      { $sort: { date: 1 } },
    ])
    .toArray();

  const items =
    g === 'day'
      ? fillSeriesBuckets(
          result.map(r => ({ date: r.date, total: r.users, sessions: r.sessions })),
          start,
          end,
          'day'
        )
      : result.map(r => ({ date: r.date, total: r.users, sessions: r.sessions }));

  return {
    totals: { points: items.length },
    items,
    meta: { from: start, to: end, granularity: g },
  };
}

// PUBLIC_INTERFACE
async function getKpis({ from, to }) {
  /** Returns KPI metrics for the window: newUsers, activeUsers, returningUsers, avgSessionsPerUser. */
  const db = getDb();
  const end = coerceDate(to, new Date());
  const start = coerceDate(from, subDays(end, 30));
  const usersCol = db.collection('users');
  const sessionsExists = await collectionExists(db, 'session_tracking');

  const newUsers = await usersCol.countDocuments({
    created_at: { $gte: start, $lte: end },
  });

  const activeUsers = await activeUsersCount(db, start, end);

  let returningUsers = 0;
  let avgSessionsPerUser = 0;

  if (sessionsExists) {
    const col = db.collection('session_tracking');
    const timeExpr = buildSessionTimeField();

    // returningUsers: users with session in window AND at least one session before window
    const currentUsers = await col.distinct('user_id', {
      $expr: {
        $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
      },
    });

    if (currentUsers.length) {
      const previouslyActive = await col
        .aggregate([
          {
            $match: {
              user_id: { $in: currentUsers },
              $expr: { $lt: [timeExpr, start] },
            },
          },
          { $group: { _id: '$user_id' } },
          { $count: 'total' },
        ])
        .toArray();
      returningUsers = previouslyActive.length ? previouslyActive[0].total : 0;
    }

    // avgSessionsPerUser within window
    const sessionAgg = await col
      .aggregate([
        {
          $match: {
            $expr: {
              $and: [{ $gte: [timeExpr, start] }, { $lte: [timeExpr, end] }],
            },
          },
        },
        {
          $group: {
            _id: '$user_id',
            sessions: { $sum: 1 },
          },
        },
        {
          $group: {
            _id: null,
            users: { $sum: 1 },
            totalSessions: { $sum: '$sessions' },
          },
        },
      ])
      .toArray();

    if (sessionAgg.length) {
      const row = sessionAgg[0];
      avgSessionsPerUser = row.users ? row.totalSessions / row.users : 0;
    }
  } else {
    // Fallback heuristics: returningUsers approximated as users with updated_at before and within window
    const currentActiveUsers = await usersCol.distinct('_id', {
      $or: [
        { updated_at: { $gte: start, $lte: end } },
        { accepted_terms_at: { $gte: start, $lte: end } },
        { created_at: { $gte: start, $lte: end } },
      ],
    });
    if (currentActiveUsers.length) {
      const prev = await usersCol.countDocuments({
        _id: { $in: currentActiveUsers },
        updated_at: { $lt: start },
      });
      returningUsers = prev;
    }
    avgSessionsPerUser = 0; // Unknown without sessions
  }

  return {
    totals: {
      newUsers,
      activeUsers,
      returningUsers,
      avgSessionsPerUser,
    },
    items: [
      { label: 'New Users', count: newUsers },
      { label: 'Active Users', count: activeUsers },
      { label: 'Returning Users', count: returningUsers },
      { label: 'Avg Sessions/User', count: avgSessionsPerUser },
    ],
    meta: { from: start, to: end, granularity: 'summary' },
  };
}

module.exports = {
  getActivitySummary,
  getActiveUsersTrend,
  getByOrganization,
  getByDepartment,
  getCompliance,
  getEngagementTrend,
  getKpis,
};
