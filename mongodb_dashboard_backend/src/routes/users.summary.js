const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * Resolve the date window for /api/users/summary and convert it to the canonical
 * from/to query params expected by /api/dashboard/users.
 *
 * Notes:
 * - /api/users/summary uses date-only windows (UTC day boundaries).
 * - /api/dashboard/users accepts ISO date-time or YYYY-MM-DD, and defaults to today UTC
 *   when from/to are omitted. We will always send explicit from/to ISO strings to keep
 *   semantics aligned with the users summary window.
 */
function resolveUsersSummaryWindowUtc({ range, start_date, end_date }) {
  const pad = (n) => String(n).padStart(2, '0');
  const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
  const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
  const addDays = (d, days) => {
    const out = new Date(d);
    out.setUTCDate(out.getUTCDate() + days);
    return out;
  };

  const today = startOfUTCDate(new Date());
  let windowStart;
  let windowEnd;

  const reDate = /^\d{4}-\d{2}-\d{2}$/;
  const r = String(range || 'daily').toLowerCase();

  if (r === 'custom') {
    if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
      const err = new Error("For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD.");
      err.statusCode = 400;
      throw err;
    }
    windowStart = new Date(`${start_date}T00:00:00.000Z`);
    windowEnd = new Date(`${end_date}T23:59:59.999Z`);
    if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
      const err = new Error('Invalid start_date or end_date.');
      err.statusCode = 400;
      throw err;
    }
    if (windowStart.getTime() > windowEnd.getTime()) {
      const err = new Error('start_date must be before or equal to end_date.');
      err.statusCode = 400;
      throw err;
    }
  } else if (r === 'daily') {
    windowStart = startOfUTCDate(today);
    windowEnd = endOfUTCDate(today);
  } else if (r === 'weekly') {
    windowStart = startOfUTCDate(addDays(today, -6));
    windowEnd = endOfUTCDate(today);
  } else if (r === 'monthly') {
    windowStart = startOfUTCDate(addDays(today, -29));
    windowEnd = endOfUTCDate(today);
  } else {
    const err = new Error("Invalid 'range'. Allowed values: daily|weekly|monthly|custom.");
    err.statusCode = 400;
    throw err;
  }

  return {
    windowStart,
    windowEnd,
    startOfUTCDate,
    endOfUTCDate,
    addDays,
    toYMD,
  };
}

// PUBLIC_INTERFACE
/**
 * GET /api/users/summary
 * Users created summary grouped by time buckets with tenant scoping.
 *
 * Also returns:
 * - total_sessions: total number of sessions within the same selected date window,
 *   derived from the canonical /api/dashboard/users endpoint (sum of per-user totalSessions).
 *
 * Special case:
 * - When organization_id === 'T0000' (case-insensitive), return an all-organizations view:
 *   - buckets: daily totals across ALL orgs
 *   - orgBuckets: array per organization_id with aligned daily counts for stacked charting
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
 *   total_sessions: number,
 *   orgBuckets?: [{
 *     organization_id: string,
 *     total: number,
 *     buckets: [{ label: string, count: number }]
 *   }],
 *   range,
 *   start_date,
 *   end_date
 * }
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  // CORS diagnostics for GET
  try {
    const origin = req.headers?.origin || 'n/a';
    const acao = res.getHeader('Access-Control-Allow-Origin') || 'n/a';
    const acc = res.getHeader('Access-Control-Allow-Credentials') || 'n/a';
    // eslint-disable-next-line no-console
    console.log(`[CORS][GET users.summary] origin=${origin} ACAO=${acao} ACC=${acc}`);
  } catch {}
  try {
    let { range = 'daily', start_date, end_date, organization_id, tenant_id } = req.query || {};
    range = String(range || 'daily').toLowerCase();

    if (range !== 'custom' && (start_date || end_date)) {
      // If user passes dates with non-custom, we allow but ignore; add header note for transparency
      res.setHeader('x-users-summary-note', 'start_date/end_date ignored unless range=custom');
    }

    // Determine effective tenant and global aggregation flag
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    const effectiveTenant = req.organizationId || req.tenantId || organization_id || tenant_id || null;

    // Special organization_id=T0000 triggers all-org aggregation (without requiring super admin)
    const isT0000 = String(effectiveTenant || '').trim().toUpperCase() === 'T0000';

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({ message: 'Missing organization_id/tenant_id.' });
    }

    const {
      windowStart,
      windowEnd,
      startOfUTCDate,
      endOfUTCDate,
      addDays,
      toYMD,
    } = resolveUsersSummaryWindowUtc({ range, start_date, end_date });

    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };

    // For normal orgs → apply tenant filter; For T0000 or super-admin global → no tenant filter
    if (!isGlobal && !isT0000 && effectiveTenant) {
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },
        { organizationId: effectiveTenant },
        { tenantId: effectiveTenant },
        { orgId: effectiveTenant },
        { 'tenant.tenant_id': effectiveTenant },
      ];
    }

    // Bucketing expressions (always day-level)
    const bucketBoundaryExpr = { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } };

    // Prefer native driver db handle if available
    const db = req.app.get('db');

    // Base pipeline for bucketed counts
    const basePipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketBoundaryExpr } },
      { $group: { _id: '$_bucketStart', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          start: '$_id',
          end: {
            $dateSubtract: {
              startDate: { $dateAdd: { startDate: '$_id', unit: 'day', amount: 1 } },
              unit: 'millisecond',
              amount: 1,
            },
          },
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          count: 1,
        },
      },
    ];

    // Optional per-organization breakdown when all-org view is active (T0000)
    const perOrgPipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketBoundaryExpr } },
      {
        $group: {
          _id: {
            bucket: '$_bucketStart',
            org: {
              $ifNull: [
                '$tenant_id',
                { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', '$tenantId'] }] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id.bucket',
          org: { $ifNull: ['$_id.org', 'unknown'] },
          count: 1,
        },
      },
      { $sort: { bucket: 1, org: 1 } },
    ];

    // Derive total_sessions from canonical /api/dashboard/users aggregation.
    // We run an equivalent aggregation directly against session_tracking (same logic as dashboard.users.routes.js),
    // then sum per-user distinct session counts.
    const requestedTenant = effectiveTenant || '';
    const isAllTenants = isT0000;

    const timeRange = { $gte: windowStart, $lte: windowEnd };
    const timeOr = [
      { last_updated: timeRange },
      { session_start: timeRange },
      { timestamp: timeRange },
    ];

    const matchAnd = [];
    if (!isAllTenants) {
      matchAnd.push({
        $or: [
          { tenant_id: requestedTenant },
          { organization_id: requestedTenant },
          { organizationId: requestedTenant },
          { tenantId: requestedTenant },
          { orgId: requestedTenant },
          { 'tenant.tenant_id': requestedTenant },
        ],
      });
    }
    matchAnd.push({ $or: timeOr });

    const dashboardMatchStage = matchAnd.length ? { $match: { $and: matchAnd } } : { $match: {} };

    const canonicalTotalSessionsPipeline = [
      dashboardMatchStage,
      {
        $project: {
          userId: { $toString: '$user_id' },
          sessionId: {
            $cond: [
              { $or: [{ $eq: ['$session_id', null] }, { $eq: ['$session_id', ''] }] },
              { $toString: '$_id' },
              { $toString: '$session_id' },
            ],
          },
        },
      },
      { $match: { userId: { $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$userId',
          sessionIds: { $addToSet: '$sessionId' },
        },
      },
      {
        $project: {
          _id: 0,
          totalSessions: {
            $size: {
              $filter: {
                input: '$sessionIds',
                as: 's',
                cond: { $and: [{ $ne: ['$$s', null] }, { $ne: ['$$s', ''] }] },
              },
            },
          },
        },
      },
      {
        $group: {
          _id: null,
          total_sessions: { $sum: '$totalSessions' },
        },
      },
    ];

    // Execute aggregations
    const [bucketResults, totalSessionsAgg] = await Promise.all([
      (db && typeof db.collection === 'function')
        ? db.collection('users').aggregate(basePipeline, { allowDiskUse: true }).toArray()
        : User.aggregate(basePipeline).allowDiskUse(true),
      (db && typeof db.collection === 'function')
        ? db.collection('session_tracking').aggregate(canonicalTotalSessionsPipeline, { allowDiskUse: true }).toArray()
        : mongoose.connection.collection('session_tracking').aggregate(canonicalTotalSessionsPipeline, { allowDiskUse: true }).toArray(),
    ]);

    const total_sessions = Number(totalSessionsAgg?.[0]?.total_sessions || 0);

    // Ensure contiguous buckets with zero fill
    const ticks = [];
    let d = startOfUTCDate(windowStart);
    const endDay = startOfUTCDate(windowEnd);
    while (d.getTime() <= endDay.getTime()) {
      ticks.push(new Date(d));
      d = addDays(d, 1);
    }

    const map = new Map();
    for (const r of bucketResults) {
      const key = new Date(r.start).toISOString();
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
        count: Number(found?.count || 0),
      };
    });

    // If T0000, also compute per-organization series for UI when needed
    let orgBuckets = undefined;
    if (isT0000) {
      let perOrgRaw;
      if (db && typeof db.collection === 'function') {
        perOrgRaw = await db.collection('users').aggregate(perOrgPipeline, { allowDiskUse: true }).toArray();
      } else {
        perOrgRaw = await User.aggregate(perOrgPipeline).allowDiskUse(true);
      }

      // Group by org with per-day buckets; also compute org-level totals for convenience
      const orgMap = new Map(); // org -> Map(dateLabel -> count)
      const orgTotals = new Map(); // org -> total count
      for (const row of perOrgRaw) {
        const dateLabel =
          typeof row.bucket === 'string' ? row.bucket : new Date(row.bucket).toISOString().slice(0, 10);
        const org = String(row.org || 'unknown');
        const c = Number(row.count || 0);
        if (!orgMap.has(org)) orgMap.set(org, new Map());
        orgMap.get(org).set(dateLabel, (orgMap.get(org).get(dateLabel) || 0) + c);
        orgTotals.set(org, (orgTotals.get(org) || 0) + c);
      }

      // For each org, produce a daily array aligned to ticks
      orgBuckets = Array.from(orgMap.entries()).map(([org, dateMap]) => {
        const series = ticks.map((t) => {
          const lbl = toYMD(t);
          return { label: lbl, count: Number(dateMap.get(lbl) || 0) };
        });
        return {
          organization_id: org,
          total: Number(orgTotals.get(org) || 0),
          buckets: series,
        };
      });

      // Sort orgs descending by total for deterministic rendering
      orgBuckets.sort((a, b) => b.total - a.total);

      // Add response hint header
      try {
        res.setHeader('x-users-summary-org-buckets', String(orgBuckets.length));
      } catch {}
    }

    const response = {
      buckets,
      total_sessions,
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
    };
    if (isT0000) {
      response.orgBuckets = orgBuckets || [];
      try {
        res.setHeader('x-users-summary-mode', 'all_orgs');
      } catch {}
    }

    return res.status(200).json(response);
  } catch (err) {
    const statusCode = Number(err?.statusCode) || 500;
    if (statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    // eslint-disable-next-line no-console
    console.error('[users.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
