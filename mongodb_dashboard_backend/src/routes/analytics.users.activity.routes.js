'use strict';

const express = require('express');
const router = express.Router();
const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model');
const { asyncHandler } = require('../utils/http');

/**
 * Coerce statuses param (pipe separated) to {$in: []} or string
 */
function buildStatusMatch(statusParam) {
  if (!statusParam) return {};
  const s = String(statusParam).trim();
  if (!s) return {};
  if (s.includes('|')) {
    const parts = s.split('|').map((x) => x.trim()).filter(Boolean);
    return parts.length ? { $in: parts } : {};
  }
  return s;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/activity-trend
 * Returns time-bucketed unique active users trend derived from session_tracking
 * Query:
 * - from?: ISO datetime (default: 30 days ago)
 * - to?: ISO datetime (default: now)
 * - granularity?: 'day' | 'week' (default: 'day')
 * - status?: string pipe separated (default: 'completed|active')
 * - tenant_id?: string optional scope
 * - department?: string optional scope (applies via sessions.user_id join is not trivial; ignored by default)
 * - organization_id?: string optional alias of tenant_id (frontends sometimes send this)
 */
router.get(
  '/activity-trend',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromStr = req.query.from || defaultFrom.toISOString();
    const toStr = req.query.to || now.toISOString();
    const granularity = (req.query.granularity || 'day').toLowerCase() === 'week' ? 'week' : 'day';
    const statusParam = (req.query.status || 'completed|active').trim();
    const tenantId = req.query.tenant_id || req.query.organization_id || null;

    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    if (Number.isNaN(fromDate.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    if (Number.isNaN(toDate.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    if (toDate <= fromDate)
      return res.status(400).json({ success: false, message: '"to" must be after "from"' });

    const match = {};
    if (tenantId) match.tenant_id = String(tenantId);
    const statusMatch = buildStatusMatch(statusParam);
    if (typeof statusMatch === 'object' && statusMatch.$in) match.status = statusMatch;
    else if (typeof statusMatch === 'string') match.status = statusMatch;

    // Prefer last_updated, fallback to session_start
    const addFieldsStage = {
      $addFields: {
        activity_ts: { $ifNull: ['$last_updated', '$session_start'] },
      },
    };
    const dateMatchStage = {
      $match: {
        ...match,
        activity_ts: { $gte: fromDate, $lte: toDate },
      },
    };

    const projectBucketStage =
      granularity === 'week'
        ? {
            $project: {
              tenant_id: 1,
              user_id_str: { $toString: '$user_id' },
              bucket: {
                $dateToString: {
                  format: '%G-%V', // ISO week-year-week
                  date: '$activity_ts',
                  timezone: 'UTC',
                },
              },
              weekStart: {
                $dateFromParts: {
                  isoWeekYear: { $isoWeekYear: '$activity_ts' },
                  isoWeek: { $isoWeek: '$activity_ts' },
                  isoDayOfWeek: 1,
                },
              },
            },
          }
        : {
            $project: {
              tenant_id: 1,
              user_id_str: { $toString: '$user_id' },
              bucket: {
                $dateToString: { format: '%Y-%m-%d', date: '$activity_ts', timezone: 'UTC' },
              },
            },
          };

    const pipeline = [
      addFieldsStage,
      dateMatchStage,
      projectBucketStage,
      { $group: { _id: { bucket: '$bucket', user_id: '$user_id_str' } } },
      {
        $group: {
          _id: '$_id.bucket',
          total: { $sum: 1 },
          weekStart: granularity === 'week' ? { $first: '$weekStart' } : undefined,
        },
      },
      { $project: { _id: 0, bucket: '$_id', total: 1, weekStart: 1 } },
      { $sort: { bucket: 1 } },
    ];

    const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
    const items = rows.map((r) => {
      if (granularity === 'week' && r.weekStart) {
        const d = new Date(r.weekStart);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return { date: `${yyyy}-${mm}-${dd}`, total: r.total || 0 };
      }
      return { date: String(r.bucket), total: r.total || 0 };
    });

    return res.status(200).json({
      items,
      meta: { granularity, from: fromDate.toISOString(), to: toDate.toISOString() },
    });
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/analytics/users/summary
 * Returns DAU/WAU/MAU counts using users collection created_at/updated_at for cohort size and
 * session_tracking for activity (distinct users) in the specified windows.
 * Query:
 * - to?: ISO datetime (default now)
 * - tenant_id?: string optional scope (applied on sessions; users typically not scoped by tenant unless organization_id matches)
 * - status?: pipe separated session statuses for activity windows (default 'completed|active')
 * - organization_id?: alias of tenant_id
 * - is_admin?: boolean to segment by role (users.is_admin)
 * - department?: string to segment via users.department
 * Response:
 * {
 *   dau: number, wau: number, mau: number,
 *   asOf: ISO,
 *   filters: { tenant_id?, status, is_admin?, department? }
 * }
 */
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(to.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }
    const statusParam = (req.query.status || 'completed|active').trim();
    const tenantId = req.query.tenant_id || req.query.organization_id || null;
    const isAdmin = typeof req.query.is_admin !== 'undefined' ? String(req.query.is_admin) : null;
    const department = req.query.department ? String(req.query.department) : null;

    // Helper ranges
    const startOf = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    const endOf = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

    const end = to;
    const startDay = startOf(end);
    const startWeek = new Date(end); startWeek.setUTCDate(end.getUTCDate() - 6); const weekStart = startOf(startWeek);
    const startMonth = new Date(end); startMonth.setUTCMonth(end.getUTCMonth() - 1); const monthStart = startOf(startMonth);

    const sessionBaseMatch = {};
    if (tenantId) sessionBaseMatch.tenant_id = String(tenantId);
    const statusMatch = buildStatusMatch(statusParam);
    if (typeof statusMatch === 'object' && statusMatch.$in) sessionBaseMatch.status = statusMatch;
    else if (typeof statusMatch === 'string') sessionBaseMatch.status = statusMatch;

    const activityTsExpr = { $ifNull: ['$last_updated', '$session_start'] };

    async function distinctActiveUsersBetween(from, toDate) {
      const m = {
        ...sessionBaseMatch,
      };
      const pipeline = [
        { $addFields: { activity_ts: activityTsExpr } },
        { $match: { ...m, activity_ts: { $gte: from, $lte: toDate } } },
        { $project: { user_id_str: { $toString: '$user_id' } } },
        { $group: { _id: '$user_id_str' } },
        { $count: 'n' },
      ];
      const out = await SessionTracking.aggregate(pipeline);
      return out?.[0]?.n || 0;
    }

    // Optional segmentation using users fields
    // We attempt to filter sessions by user set when filters like is_admin/department are provided
    // by fetching matching user IDs and restricting the sessions to those user_ids.
    let restrictedUserIds = null;
    if (isAdmin !== null || department) {
      const userFilter = {};
      if (isAdmin !== null) {
        if (['true', '1', 'yes'].includes(isAdmin.toLowerCase())) userFilter.is_admin = true;
        else if (['false', '0', 'no'].includes(isAdmin.toLowerCase())) userFilter.is_admin = false;
      }
      if (department) userFilter.department = department;
      if (tenantId) {
        // try to scope users by org if present on users
        userFilter.$or = [
          { organization_id: String(tenantId) },
          { tenant_id: String(tenantId) },
          { 'tenant.tenant_id': String(tenantId) },
        ];
      }
      const ids = await User.find(userFilter, { _id: 1, user_id: 1 }).lean();
      if (ids.length) {
        restrictedUserIds = new Set(ids.map((d) => (d.user_id ? String(d.user_id) : String(d._id))));
      } else {
        // If no users match filters, activity is zero
        return res.status(200).json({
          dau: 0, wau: 0, mau: 0,
          asOf: end.toISOString(),
          filters: { tenant_id: tenantId || null, status: statusParam, is_admin: isAdmin, department: department || null },
        });
      }
    }

    // If restrictedUserIds is provided, use it in the aggregation by adding $match on user_id
    async function distinctActiveUsersBetweenRestricted(from, toDate) {
      if (!restrictedUserIds) return distinctActiveUsersBetween(from, toDate);
      const m = {
        ...sessionBaseMatch,
      };
      const pipeline = [
        { $addFields: { activity_ts: activityTsExpr, user_id_str: { $toString: '$user_id' } } },
        {
          $match: {
            ...m,
            activity_ts: { $gte: from, $lte: toDate },
            user_id_str: { $in: Array.from(restrictedUserIds) },
          },
        },
        { $group: { _id: '$user_id_str' } },
        { $count: 'n' },
      ];
      const out = await SessionTracking.aggregate(pipeline);
      return out?.[0]?.n || 0;
    }

    const [dau, wau, mau] = await Promise.all([
      distinctActiveUsersBetweenRestricted(startDay, endOf(end)),
      distinctActiveUsersBetweenRestricted(weekStart, endOf(end)),
      distinctActiveUsersBetweenRestricted(monthStart, endOf(end)),
    ]);

    return res.status(200).json({
      dau,
      wau,
      mau,
      asOf: end.toISOString(),
      filters: {
        tenant_id: tenantId || null,
        status: statusParam,
        is_admin: isAdmin,
        department: department || null,
      },
    });
  })
);

module.exports = router;
