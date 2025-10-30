'use strict';

/**
 * Users Analytics Router (v2)
 * Provides analytics endpoints under /api/users/analytics
 * Filters supported: organization_id, department, status, from, to
 *
 * Notes:
 * - Engagement metrics default to active users only unless status is explicitly provided.
 * - Date handling is UTC. from/to are ISO strings; from inclusive, to exclusive upper bound.
 * - Index recommendations: users.created_at, users.updated_at, users.organization_id, users.department
 */

const express = require('express');
const router = express.Router();
const { ensureDateRange, buildMatchFilters } = require('../utils/analytics.users.filters');
const { getDb } = require('../config/db');

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/activity-trends
 * Summary: Daily active users with DAU/WAU/MAU and time series per day.
 * Query: organization_id, department, status, from, to
 * Returns: { meta: {...}, kpis:{DAU, WAU, MAU}, series: [{date: 'YYYY-MM-DD', value: number}] }
 */
router.get('/activity-trends', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');

    const { organization_id, department, status, from, to } = req.query;
    const { fromDate, toDate } = ensureDateRange(from, to, 30);

    const statusFilter = status || 'active'; // default to active users only for engagement
    const match = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: fromDate, to: toDate },
      'updated_at'
    );

    // Daily series: count of users updated on that day (engagement proxy). Uses updated_at.
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            y: { $year: '$updated_at' },
            m: { $month: '$updated_at' },
            d: { $dayOfMonth: '$updated_at' },
          },
          value: { $addToSet: '$_id' }, // dedupe users in a day
        },
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateToString: {
              date: {
                $dateFromParts: {
                  year: '$_id.y',
                  month: '$_id.m',
                  day: '$_id.d',
                },
              },
              format: '%Y-%m-%d',
            },
          },
          value: { $size: '$value' },
        },
      },
      { $sort: { date: 1 } },
    ];

    const series = await usersCol.aggregate(pipeline).toArray();

    // Compute DAU/WAU/MAU using distinct users within last 1, 7, 30 days relative to toDate
    const dayMs = 24 * 3600 * 1000;
    const dauFrom = new Date(toDate.getTime() - dayMs);
    dauFrom.setUTCHours(0, 0, 0, 0);
    const wauFrom = new Date(toDate.getTime() - 7 * dayMs);
    const mauFrom = new Date(toDate.getTime() - 30 * dayMs);

    const dauMatch = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: dauFrom, to: toDate },
      'updated_at'
    );
    const wauMatch = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: wauFrom, to: toDate },
      'updated_at'
    );
    const mauMatch = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: mauFrom, to: toDate },
      'updated_at'
    );

    const [DAU, WAU, MAU] = await Promise.all([
      usersCol.distinct('_id', dauMatch).then((a) => a.length),
      usersCol.distinct('_id', wauMatch).then((a) => a.length),
      usersCol.distinct('_id', mauMatch).then((a) => a.length),
    ]);

    return res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        organization_id: organization_id || null,
        department: department || null,
        status: statusFilter,
      },
      kpis: { DAU, WAU, MAU },
      series,
      notes: [
        'Defaults to status=active for engagement unless overridden.',
        'Index recommended: { updated_at: 1 }, { created_at: 1 }, and optionally compound with organization_id/department.',
      ],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/growth
 * Summary: New users by day|week|month with simple period-over-period growth rate.
 * Query: organization_id, department, status, from, to, granularity=day|week|month
 * Returns: { meta, series:[{label, value}], totals: { totalNew }, growthRate: number|null }
 */
router.get('/growth', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');

    const { organization_id, department, status, from, to, granularity } = req.query;
    const { fromDate, toDate } = ensureDateRange(from, to, 90);
    const bucket = (granularity || 'day').toLowerCase();

    const statusFilter = status || undefined; // growth considers created users; do not force active by default
    const match = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: fromDate, to: toDate },
      'created_at'
    );

    const dateTrunc = {
      day: { unit: 'day' },
      week: { unit: 'week' },
      month: { unit: 'month' },
    }[bucket] || { unit: 'day' };

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$created_at',
              unit: dateTrunc.unit,
            },
          },
          value: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          label: { $dateToString: { date: '$_id', format: '%Y-%m-%d' } },
          value: 1,
        },
      },
    ];

    const series = await usersCol.aggregate(pipeline).toArray();
    const totalNew = series.reduce((acc, x) => acc + (x.value || 0), 0);

    // Growth rate = (currentPeriod - previousPeriod)/previousPeriod
    // Previous period length equals current window length.
    const windowMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - windowMs);
    const prevTo = fromDate;

    const prevMatch = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: prevFrom, to: prevTo },
      'created_at'
    );
    const prevTotal = await usersCol.countDocuments(prevMatch);
    const growthRate = prevTotal > 0 ? (totalNew - prevTotal) / prevTotal : null;

    return res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        granularity: bucket,
        organization_id: organization_id || null,
        department: department || null,
        status: statusFilter || null,
      },
      series,
      totals: { totalNew, previousPeriod: prevTotal },
      growthRate,
      notes: ['Index recommended: { created_at: 1 }', 'For chart gaps, client can fill missing intervals.'],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/activity-breakdown
 * Summary: Active users by department and by organization.
 * Query: organization_id, department, status, from, to
 * Returns: { byDepartment:[{label,count}], byOrganization:[{label,count}] }
 */
router.get('/activity-breakdown', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');
    const { organization_id, department, status, from, to } = req.query;
    const { fromDate, toDate } = ensureDateRange(from, to, 30);
    const statusFilter = status || 'active';
    const match = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: fromDate, to: toDate },
      'updated_at'
    );

    // By department
    const byDept = await usersCol
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ['$department', 'Unknown'] },
            users: { $addToSet: '$_id' },
          },
        },
        { $project: { _id: 0, label: '$_id', count: { $size: '$users' } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    // By organization
    const byOrg = await usersCol
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: { $ifNull: ['$organization_id', 'Unknown'] },
            users: { $addToSet: '$_id' },
          },
        },
        { $project: { _id: 0, label: '$_id', count: { $size: '$users' } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        organization_id: organization_id || null,
        department: department || null,
        status: statusFilter,
      },
      byDepartment: byDept,
      byOrganization: byOrg,
      notes: ['Indexes: { updated_at: 1 }, { department: 1 }, { organization_id: 1 }'],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/inactivity
 * Summary: Counts by inactivity thresholds and active/inactive ratio
 * Query: organization_id, department, status, from, to
 * Returns: { thresholds: { gt7, gt14, gt30, gt60, gt90 }, totals:{active,inactive}, ratio:{activeToInactive} }
 */
router.get('/inactivity', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');
    const { organization_id, department } = req.query;
    // Inactivity computed relative to "now"—no need for from/to; but keep filters
    const now = new Date();

    const base = buildMatchFilters({ organization_id, department }, 'updated_at', { omitDates: true });

    // Build thresholds
    const thresholds = [7, 14, 30, 60, 90];
    const results = {};
    await Promise.all(
      thresholds.map(async (d) => {
        const cutoff = new Date(now.getTime() - d * 24 * 3600 * 1000);
        const count = await usersCol.countDocuments({ ...base, updated_at: { $lt: cutoff } });
        results[`gt${d}`] = count;
      })
    );

    // Active vs inactive (30-day window)
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const activeCount = await usersCol.countDocuments({ ...base, updated_at: { $gte: cutoff30 } });
    const total = await usersCol.countDocuments(base);
    const inactiveCount = Math.max(total - activeCount, 0);
    const ratio = inactiveCount > 0 ? activeCount / inactiveCount : null;

    res.json({
      meta: {
        asOf: now.toISOString(),
        organization_id: organization_id || null,
        department: department || null,
      },
      thresholds: results,
      totals: { active: activeCount, inactive: inactiveCount, total },
      ratio: { activeToInactive: ratio },
      notes: ['Indexes: { updated_at: 1 } help inactivity queries.'],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/compliance
 * Summary: Acceptance compliance: percent accepted and time-to-accept (if accepted_at exists)
 * Query: organization_id, department, from, to
 * Returns: { percentAccepted, avgTimeToAcceptDays, series:[{label,value}] }
 */
router.get('/compliance', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');

    const { organization_id, department, from, to } = req.query;
    const { fromDate, toDate } = ensureDateRange(from, to, 90);

    // Filter on created_at for denominator window; then compute accepted within same window
    const baseMatch = buildMatchFilters({ organization_id, department, from: fromDate, to: toDate }, 'created_at');

    const pipeline = [
      { $match: baseMatch },
      {
        $project: {
          created_at: 1,
          accepted_at: 1,
          accepted: { $cond: [{ $ifNull: ['$accepted_at', false] }, 1, 0] },
          timeToAcceptMs: {
            $cond: [
              { $and: [{ $ifNull: ['$accepted_at', false] }, { $gte: ['$accepted_at', fromDate] }, { $lt: ['$accepted_at', toDate] }] },
              { $subtract: ['$accepted_at', '$created_at'] },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          acceptedCount: { $sum: '$accepted' },
          avgTimeToAcceptMs: { $avg: '$timeToAcceptMs' },
        },
      },
    ];

    const agg = await usersCol.aggregate(pipeline).toArray();
    const row = agg[0] || { total: 0, acceptedCount: 0, avgTimeToAcceptMs: null };
    const percentAccepted = row.total > 0 ? row.acceptedCount / row.total : null;
    const avgDays = row.avgTimeToAcceptMs != null ? row.avgTimeToAcceptMs / (1000 * 60 * 60 * 24) : null;

    // Series by week: acceptance rate
    const series = await usersCol
      .aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $dateTrunc: { date: '$created_at', unit: 'week' } },
            total: { $sum: 1 },
            accepted: {
              $sum: {
                $cond: [{ $ifNull: ['$accepted_at', false] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            label: { $dateToString: { date: '$_id', format: '%Y-%m-%d' } },
            value: {
              $cond: [{ $gt: ['$total', 0] }, { $divide: ['$accepted', '$total'] }, null],
            },
          },
        },
        { $sort: { label: 1 } },
      ])
      .toArray();

    res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        organization_id: organization_id || null,
        department: department || null,
      },
      percentAccepted,
      avgTimeToAcceptDays: avgDays,
      series,
      notes: ['Assumes users.accepted_at exists when acceptance happens. Indexes: { created_at: 1 }, { accepted_at: 1 }.'],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/retention-cohorts
 * Summary: Monthly cohorts based on user.created_at month with 7/30/90-day active rates (by updated_at).
 * Query: organization_id, department, from, to
 * Returns: { items:[{cohort:'YYYY-MM', size, d7, d30, d90}] }
 */
router.get('/retention-cohorts', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');
    const { organization_id, department, from, to } = req.query;
    const { fromDate, toDate } = ensureDateRange(from, to, 365);

    // Step 1: Find cohorts by created_at month
    const baseMatch = buildMatchFilters({ organization_id, department, from: fromDate, to: toDate }, 'created_at');

    const cohorts = await usersCol
      .aggregate([
        { $match: baseMatch },
        {
          $group: {
            _id: { $dateTrunc: { date: '$created_at', unit: 'month' } },
            users: { $addToSet: { id: '$_id', created_at: '$created_at' } },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    const items = [];
    for (const c of cohorts) {
      const cohortStart = c._id;
      const cohortLabel = new Date(cohortStart).toISOString().slice(0, 7); // YYYY-MM
      const ids = c.users.map((u) => u.id);
      const size = ids.length;
      if (size === 0) {
        items.push({ cohort: cohortLabel, size: 0, d7: null, d30: null, d90: null });
        continue;
      }
      // Windows from cohort start
      const d7End = new Date(new Date(cohortStart).getTime() + 7 * 24 * 3600 * 1000);
      const d30End = new Date(new Date(cohortStart).getTime() + 30 * 24 * 3600 * 1000);
      const d90End = new Date(new Date(cohortStart).getTime() + 90 * 24 * 3600 * 1000);

      const [a7, a30, a90] = await Promise.all([
        usersCol.distinct('_id', { _id: { $in: ids }, updated_at: { $gte: cohortStart, $lt: d7End } }).then((x) => x.length),
        usersCol.distinct('_id', { _id: { $in: ids }, updated_at: { $gte: cohortStart, $lt: d30End } }).then((x) => x.length),
        usersCol.distinct('_id', { _id: { $in: ids }, updated_at: { $gte: cohortStart, $lt: d90End } }).then((x) => x.length),
      ]);

      items.push({
        cohort: cohortLabel,
        size,
        d7: size > 0 ? a7 / size : null,
        d30: size > 0 ? a30 / size : null,
        d90: size > 0 ? a90 / size : null,
      });
    }

    res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        organization_id: organization_id || null,
        department: department || null,
      },
      items,
      notes: ['Retention uses updated_at as activity proxy.', 'Indexes: { created_at: 1 }, { updated_at: 1 } recommended.'],
    });
  } catch (err) {
    next(err);
  }
});

// PUBLIC_INTERFACE
/**
 * GET /api/users/analytics/top-active-users
 * Summary: Top active users based on most recent updated_at (fallback to activity counts if field exists).
 * Query: organization_id, department, status, from, to, limit
 * Returns: { items:[{user_id, email, name, department, organization_id, last_active_at}], total }
 */
router.get('/top-active-users', async (req, res, next) => {
  try {
    const db = getDb();
    const usersCol = db.collection('users');

    const { organization_id, department, status, from, to } = req.query;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10), 200));
    const { fromDate, toDate } = ensureDateRange(from, to, 30);
    const statusFilter = status || 'active';
    const match = buildMatchFilters(
      { organization_id, department, status: statusFilter, from: fromDate, to: toDate },
      'updated_at'
    );

    const items = await usersCol
      .aggregate([
        { $match: match },
        {
          $project: {
            email: 1,
            name: 1,
            department: 1,
            organization_id: 1,
            last_active_at: '$updated_at',
          },
        },
        { $sort: { last_active_at: -1 } },
        { $limit: limit },
      ])
      .toArray();

    res.json({
      meta: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        limit,
        organization_id: organization_id || null,
        department: department || null,
        status: statusFilter,
      },
      items: items.map((u) => ({
        user_id: String(u._id),
        email: u.email || null,
        name: u.name || null,
        department: u.department || null,
        organization_id: u.organization_id || null,
        last_active_at: u.last_active_at ? new Date(u.last_active_at).toISOString() : null,
      })),
      total: items.length,
      notes: ['Sorting on updated_at benefits from an index: { updated_at: -1 }'],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
