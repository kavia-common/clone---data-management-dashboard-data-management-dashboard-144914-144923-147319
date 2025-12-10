const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user.model');
const { extractOrganization } = require('../middleware/extractOrganization');

// PUBLIC_INTERFACE
/**
 * GET /api/users/summary
 * Users created summary grouped by time buckets with tenant scoping.
 *
 * Query params:
 * - organization_id (alias tenant_id): required unless super-admin/global bypass is active
 * - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 * - start_date, end_date (YYYY-MM-DD) required when range='custom'
 *
 * Defaults when start/end not provided:
 * - daily: last 30 days
 * - weekly: last 12 weeks
 * - monthly: last 12 months
 *
 * Returns 200 JSON:
 * {
 *   buckets: [{ label, count, start, end }],
 *   range,
 *   start_date,
 *   end_date
 * }
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Use daily|weekly|monthly|custom." });
    }

    // Determine effective tenant:
    // - Super admin/global bypass is supported by extractOrganization (req.tenantScopeDisabled/allTenants)
    // - For normal users, extractOrganization ensures req.organizationId is present or 400.
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    const effectiveTenant = req.organizationId || req.tenantId || null;

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const startOfUTCMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };
    const addWeeks = (d, weeks) => addDays(d, weeks * 7);
    const addMonths = (d, months) => {
      const out = new Date(d);
      out.setUTCMonth(out.getUTCMonth() + months);
      return out;
    };

    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;

    const reDate = /^\d{4}-\d{2}-\d{2}$/;

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({ message: "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD." });
      }
      windowStart = new Date(`${start_date}T00:00:00.000Z`);
      windowEnd = new Date(`${end_date}T23:59:59.999Z`);
      if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
        return res.status(400).json({ message: 'Invalid start_date or end_date.' });
      }
      if (windowStart.getTime() > windowEnd.getTime()) {
        return res.status(400).json({ message: 'start_date must be before or equal to end_date.' });
      }
    } else if (range === 'daily') {
      // Default to last 30 days ending today
      const end = endOfUTCDate(today);
      const start = startOfUTCDate(addDays(today, -29));
      windowStart = start; windowEnd = end;
    } else if (range === 'weekly') {
      // Last 12 ISO weeks ending with the current week
      const dow = today.getUTCDay() || 7; // Monday=1..Sunday=7
      const currentWeekStart = addDays(today, -(dow - 1)); // Monday
      const start = startOfUTCDate(addWeeks(currentWeekStart, -11)); // 12 weeks window
      const end = endOfUTCDate(addDays(currentWeekStart, 6)); // end of current week (Sunday)
      windowStart = start; windowEnd = end;
    } else if (range === 'monthly') {
      // Last 12 months including this month
      const currentMonthStart = startOfUTCMonth(today);
      const start = startOfUTCMonth(addMonths(currentMonthStart, -11));
      // End is end of current day in current month to avoid needing days-in-month calc
      const end = endOfUTCDate(today);
      windowStart = start; windowEnd = end;
    }

    // Build match with tenant scoping; normalize tenant fields in users collection
    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };
    if (!isGlobal && effectiveTenant) {
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },
        { organizationId: effectiveTenant },
        { tenantId: effectiveTenant },
        { orgId: effectiveTenant },
        { 'tenant.tenant_id': effectiveTenant },
      ];
    }

    // Bucketing expressions
    let bucketBoundaryExpr;
    let labelProject;
    if (range === 'daily' || range === 'custom') {
      // Truncate to day
      bucketBoundaryExpr = { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } };
      labelProject = { $dateToString: { format: '%Y-%m-%d', date: '$$BOUNDARY', timezone: 'UTC' } };
    } else if (range === 'weekly') {
      // Truncate to ISO week
      // $dateTrunc unit: 'week' uses ISO 8601 weeks since MongoDB 5.0+; timezone UTC
      bucketBoundaryExpr = { $dateTrunc: { date: '$created_at', unit: 'week', timezone: 'UTC' } };
      labelProject = {
        // label as YYYY-WW (ISO)
        $concat: [
          { $toString: { $isoWeekYear: '$$BOUNDARY' } },
          '-W',
          {
            $let: {
              vars: { w: { $isoWeek: '$$BOUNDARY' } },
              in: { $cond: [{ $lt: ['$$w', 10] }, { $concat: ['0', { $toString: '$$w' }] }, { $toString: '$$w' }] }
            }
          }
        ]
      };
    } else if (range === 'monthly') {
      bucketBoundaryExpr = { $dateTrunc: { date: '$created_at', unit: 'month', timezone: 'UTC' } };
      labelProject = { $dateToString: { format: '%Y-%m', date: '$$BOUNDARY', timezone: 'UTC' } };
    }

    // Prefer native driver db handle if available
    const db = req.app.get('db');
    const pipeline = [
      { $match: match },
      {
        $set: {
          _bucketStart: bucketBoundaryExpr
        }
      },
      {
        $group: {
          _id: '$_bucketStart',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          start: '$_id',
          end: {
            $dateSubtract: {
              startDate: {
                $dateAdd: {
                  startDate: '$_id',
                  unit: range === 'weekly' ? 'week' : (range === 'monthly' ? 'month' : 'day'),
                  amount: 1
                }
              },
              unit: 'millisecond',
              amount: 1
            }
          },
          label: {
            $let: {
              vars: { BOUNDARY: '$_id' },
              in: labelProject
            }
          },
          count: 1
        }
      }
    ];

    let results;
    if (db && typeof db.collection === 'function') {
      results = await db.collection('users').aggregate(pipeline, { allowDiskUse: true }).toArray();
    } else {
      // use mongoose aggregation
      results = await User.aggregate(pipeline).allowDiskUse(true);
    }

    // Ensure coverage for empty intervals: generate bins with zero counts
    // Build boundary ticks in app to fill gaps
    const ticks = [];
    const pushTick = (d) => ticks.push(new Date(d));
    if (range === 'daily' || range === 'custom') {
      let d = startOfUTCDate(windowStart);
      while (d.getTime() <= startOfUTCDate(windowEnd).getTime()) {
        pushTick(d);
        d = addDays(d, 1);
      }
    } else if (range === 'weekly') {
      // align to Monday
      const dow = windowStart.getUTCDay() || 7;
      let d = startOfUTCDate(addDays(windowStart, -(dow - 1)));
      const endAligned = startOfUTCDate(addDays(windowEnd, 0));
      while (d.getTime() <= endAligned.getTime()) {
        pushTick(d);
        d = addWeeks(d, 1);
      }
    } else if (range === 'monthly') {
      let d = startOfUTCMonth(windowStart);
      const endMonth = startOfUTCMonth(windowEnd);
      while (d.getTime() <= endMonth.getTime()) {
        pushTick(d);
        d = startOfUTCMonth(addMonths(d, 1));
      }
    }

    const map = new Map();
    for (const r of results) {
      const key = (new Date(r.start)).toISOString();
      map.set(key, r);
    }

    const buckets = ticks.map((t) => {
      const start = new Date(t);
      const unit = range === 'weekly' ? 'week' : (range === 'monthly' ? 'month' : 'day');
      let end;
      if (unit === 'day') {
        end = endOfUTCDate(start);
      } else if (unit === 'week') {
        end = endOfUTCDate(addDays(start, 6));
      } else {
        // monthly: compute end as one month minus 1ms
        const next = startOfUTCMonth(addMonths(start, 1));
        end = new Date(next.getTime() - 1);
      }
      const isoKey = start.toISOString();
      const found = map.get(isoKey);
      const label =
        range === 'weekly'
          ? `${start.getUTCFullYear()}-W${String(getISOWeek(start)).padStart(2, '0')}`
          : (range === 'monthly' ? `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`
                                 : toYMD(start));
      return {
        label,
        count: Number(found?.count || 0),
        start: start.toISOString(),
        end: end.toISOString()
      };
    });

    // helper for ISO week number for labeling
    function getISOWeek(date) {
      const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      // Thursday in current week decides the year
      tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
      // First week of year starts with the week that contains Jan 4th
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
      return weekNo;
    }

    return res.status(200).json({
      buckets,
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd)
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[users.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
