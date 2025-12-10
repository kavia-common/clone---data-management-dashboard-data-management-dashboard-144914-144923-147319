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
 * Date range semantics:
 * - daily: today only
 * - weekly: today and previous 6 days (7 days total)
 * - monthly: today and previous 29 days (30 days total)
 * - custom: inclusive start_date to end_date (YYYY-MM-DD), grouped by day
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
    let { range = 'daily', start_date, end_date, organization_id, tenant_id } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({
        message: "Invalid 'range'. Allowed values: daily|weekly|monthly|custom.",
        hint: "For range=custom, provide start_date and end_date in YYYY-MM-DD."
      });
    }
    if (range !== 'custom' && (start_date || end_date)) {
      // If user passes dates with non-custom, we allow but ignore; add header note for transparency
      res.setHeader('x-users-summary-note', 'start_date/end_date ignored unless range=custom');
    }

    // Determine effective tenant:
    // - Super admin/global bypass is supported by extractOrganization (req.tenantScopeDisabled/allTenants)
    // - For normal users, extractOrganization ensures req.organizationId is present or 400.
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    // accept explicit query aliases as fallback if middleware didn't resolve
    const effectiveTenant = req.organizationId || req.tenantId || organization_id || tenant_id || null;
    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({ message: "Missing organization_id/tenant_id." });
    }

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
      // today only
      windowStart = startOfUTCDate(today);
      windowEnd = endOfUTCDate(today);
    } else if (range === 'weekly') {
      // today through last 6 days (7-day window), grouped by day
      windowStart = startOfUTCDate(addDays(today, -6));
      windowEnd = endOfUTCDate(today);
    } else if (range === 'monthly') {
      // today through last 29 days (30-day window), grouped by day
      windowStart = startOfUTCDate(addDays(today, -29));
      windowEnd = endOfUTCDate(today);
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

    // Bucketing expressions (always day-level to satisfy chart requirement)
    const bucketBoundaryExpr = { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } };

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
              startDate: { $dateAdd: { startDate: '$_id', unit: 'day', amount: 1 } },
              unit: 'millisecond',
              amount: 1
            }
          },
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
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
    {
      // Always produce contiguous daily ticks from windowStart..windowEnd inclusive
      let d = startOfUTCDate(windowStart);
      const endDay = startOfUTCDate(windowEnd);
      while (d.getTime() <= endDay.getTime()) {
        pushTick(d);
        d = addDays(d, 1);
      }
    }

    const map = new Map();
    for (const r of results) {
      const key = (new Date(r.start)).toISOString();
      map.set(key, r);
    }

    const buckets = ticks.map((t) => {
      const start = new Date(t);
      const end = endOfUTCDate(start);
      const isoKey = start.toISOString();
      const found = map.get(isoKey);
      return {
        label: toYMD(start),
        start: start.toISOString(),
        end: end.toISOString(),
        count: Number(found?.count || 0)
      };
    });



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
