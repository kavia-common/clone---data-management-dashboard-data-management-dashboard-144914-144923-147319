const express = require('express');
const router = express.Router();

// Use native driver handle when available; otherwise fall back to Mongoose model
const SessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Projects created summary (derived from session_tracking) grouped by daily time buckets with tenant scoping.
 *
 * Behavior:
 * - Parity with /api/users/summary semantics and shape.
 * - Uses session_tracking.created_at as the canonical timestamp.
 * - Supports range=daily|weekly|monthly|custom with YYYY-MM-DD bounds for custom.
 * - For regular orgs: applies tenant filter via aliases (tenant_id, organization_id, etc.).
 * - For orgId === 'T0000': treat as all-tenant mode; produce:
 *    • buckets: daily totals across ALL orgs
 *    • orgBuckets: array per organization_id with aligned daily counts for horizontal charting
 *
 * Response (200):
 * {
 *   buckets: [{ label, count, start, end }],
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
  // Lightweight CORS diagnoser
  try {
    const origin = req.headers?.origin || 'n/a';
    const acao = res.getHeader('Access-Control-Allow-Origin') || 'n/a';
    const acc = res.getHeader('Access-Control-Allow-Credentials') || 'n/a';
    // eslint-disable-next-line no-console
    console.log(`[CORS][GET projects.summary] origin=${origin} ACAO=${acao} ACC=${acc}`);
  } catch {}

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
      try { res.setHeader('x-projects-summary-note', 'start_date/end_date ignored unless range=custom'); } catch {}
    }

    // Determine effective tenant and global aggregation flag
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    // extractOrganization middleware can populate req.organizationId / req.tenantId
    const effectiveTenant = req.organizationId || req.tenantId || organization_id || tenant_id || null;
    const isT0000 = String(effectiveTenant || '').trim().toUpperCase() === 'T0000';

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({ message: "Missing organization_id/tenant_id." });
    }

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const addDays = (d, days) => { const out = new Date(d); out.setUTCDate(out.getUTCDate() + days); return out; };

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
      windowStart = startOfUTCDate(today);
      windowEnd = endOfUTCDate(today);
    } else if (range === 'weekly') {
      windowStart = startOfUTCDate(addDays(today, -6));
      windowEnd = endOfUTCDate(today);
    } else if (range === 'monthly') {
      windowStart = startOfUTCDate(addDays(today, -29));
      windowEnd = endOfUTCDate(today);
    }

    // Date range filter on session_tracking timestamp
    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };

    // For normal orgs → apply tenant filter; For T0000 or super-admin global → no tenant filter
    if (!isGlobal && !isT0000 && effectiveTenant) {
      // map organization_id aliases to tenant_id in SessionTracking
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
              amount: 1
            }
          },
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          count: 1
        }
      }
    ];

    // Optional per-organization breakdown when all-org view is active (T0000)
    const perOrgPipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketBoundaryExpr } },
      {
        $group: {
          _id: { bucket: '$_bucketStart', org: { $ifNull: ['$tenant_id', { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', '$tenantId'] }] }] } },
          count: { $sum: 1 },
        }
      },
      {
        $project: {
          _id: 0,
          bucket: '$_id.bucket',
          org: { $ifNull: ['$_id.org', 'unknown'] },
          count: 1
        }
      },
      { $sort: { bucket: 1, org: 1 } }
    ];

    // Execute aggregations against session_tracking
    let bucketResults;
    if (db && typeof db.collection === 'function') {
      bucketResults = await db.collection('session_tracking').aggregate(basePipeline, { allowDiskUse: true }).toArray();
    } else {
      bucketResults = await SessionTracking.aggregate(basePipeline).allowDiskUse(true);
    }

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
      const key = (new Date(r.start)).toISOString();
      map.set(key, r);
    }

    let buckets = ticks.map((t) => {
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

    // For non-T0000 tenants (and when not in global/all-tenants mode), filter out zero-count buckets
    if (!isT0000 && !isGlobal) {
      buckets = buckets.filter(b => Number(b.count) > 0);
    }

    // If T0000, also compute per-organization series for UI when needed
    let orgBuckets = undefined;
    if (isT0000) {
      let perOrgRaw;
      if (db && typeof db.collection === 'function') {
        perOrgRaw = await db.collection('session_tracking').aggregate(perOrgPipeline, { allowDiskUse: true }).toArray();
      } else {
        perOrgRaw = await SessionTracking.aggregate(perOrgPipeline).allowDiskUse(true);
      }

      // Group by org with per-day buckets; compute org-level totals
      const orgMap = new Map(); // org -> Map(dateLabel -> count)
      const orgTotals = new Map(); // org -> total count
      for (const row of perOrgRaw) {
        const dateLabel = typeof row.bucket === 'string'
          ? row.bucket
          : new Date(row.bucket).toISOString().slice(0, 10);
        const org = String(row.org || 'unknown');
        const c = Number(row.count || 0);
        if (!orgMap.has(org)) orgMap.set(org, new Map());
        orgMap.get(org).set(dateLabel, (orgMap.get(org).get(dateLabel) || 0) + c);
        orgTotals.set(org, (orgTotals.get(org) || 0) + c);
      }

      orgBuckets = Array.from(orgMap.entries()).map(([org, dateMap]) => {
        const series = ticks.map((t) => {
          const lbl = toYMD(t);
          return { label: lbl, count: Number(dateMap.get(lbl) || 0) };
        });
        return {
          organization_id: org,
          total: Number(orgTotals.get(org) || 0),
          buckets: series
        };
      });

      orgBuckets.sort((a, b) => b.total - a.total);
      try { res.setHeader('x-projects-summary-org-buckets', String(orgBuckets.length)); } catch {}
    }

    const response = {
      buckets,
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
    };
    if (isT0000) {
      response.orgBuckets = orgBuckets || [];
      try { res.setHeader('x-projects-summary-mode', 'all_orgs'); } catch {}
    }

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
