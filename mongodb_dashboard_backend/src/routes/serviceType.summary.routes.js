const express = require('express');
const router = express.Router();
const sessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/service-type/summary
 * Aggregates session_tracking by service_type over a selected time window (daily|weekly|monthly|custom).
 *
 * Query params:
 * - organization_id (alias tenant_id): required unless super-admin/global bypass is active
 * - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 * - start_date, end_date (YYYY-MM-DD) required when range='custom'
 *
 * Date semantics:
 * - daily: today 00:00:00Z - 23:59:59Z
 * - weekly: last 7 days including today (inclusive)
 * - monthly: last 30 days including today (inclusive)
 * - custom: [start_date..end_date] inclusive (UTC)
 *
 * Returns 200 JSON:
 * {
 *   range,
 *   start_date,
 *   end_date,
 *   items: [{ service_type: string, count: number }],
 *   buckets: [{ label: 'YYYY-MM-DD', count: number }] // for completeness/consistency with similar charts
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
      });
    }

    // Determine effective tenant and global aggregation flag
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    const effectiveTenant = req.organizationId || req.tenantId || organization_id || tenant_id || null;

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({ message: 'Missing organization_id/tenant_id.' });
    }

    // Date helpers (UTC)
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

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({
          message: "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD.",
        });
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

    // Build filter: prefer last_updated, fallback to session_start, then timestamp
    const timeOr = [
      { last_updated: { $gte: windowStart, $lte: windowEnd } },
      { session_start: { $gte: windowStart, $lte: windowEnd } },
      { timestamp: { $gte: windowStart, $lte: windowEnd } },
    ];
    const match = { $or: timeOr };

    // Tenant filter (unless global)
    if (!isGlobal && effectiveTenant) {
      match.$and = [
        {
          $or: [
            { tenant_id: effectiveTenant },
            { organization_id: effectiveTenant },
            { organizationId: effectiveTenant },
            { tenantId: effectiveTenant },
            { orgId: effectiveTenant },
            { 'tenant.tenant_id': effectiveTenant },
          ],
        },
      ];
    }

    // service_type field can live under different shapes for flexible tracking.
    // We'll coalesce in aggregation using $ifNull and nested lookups when strict:false schema is used.
    const coalescedServiceType = {
      $ifNull: [
        '$service_type',
        {
          $ifNull: [
            '$serviceType',
            { $ifNull: ['$metadata.service_type', '$session_data.service_type'] },
          ],
        },
      ],
    };

    // Aggregate by service_type totals (descending)
    const pipeline = [
      { $match: match },
      { $group: { _id: coalescedServiceType, count: { $sum: 1 } } },
      { $project: { _id: 0, service_type: { $ifNull: ['$_id', 'Unknown'] }, count: 1 } },
      { $sort: { count: -1, service_type: 1 } },
    ];

    // Additionally produce daily buckets for potential time series display consistency
    const bucketBoundaryExpr = {
      $dateTrunc: { date: { $ifNull: ['$last_updated', { $ifNull: ['$session_start', '$timestamp'] }] }, unit: 'day', timezone: 'UTC' },
    };
    const bucketsPipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketBoundaryExpr } },
      { $group: { _id: '$_bucketStart', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          start: '$_id',
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          count: 1,
        },
      },
    ];

    const db = req.app.get('db');
    let items = [];
    let bucketResults = [];
    if (db && typeof db.collection === 'function') {
      items = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();
      bucketResults = await db.collection('session_tracking').aggregate(bucketsPipeline, { allowDiskUse: true }).toArray();
    } else {
      items = await sessionTracking.aggregate(pipeline).allowDiskUse(true);
      bucketResults = await sessionTracking.aggregate(bucketsPipeline).allowDiskUse(true);
    }

    // Zero-fill daily buckets to maintain contiguous days
    const ticks = [];
    let d = startOfUTCDate(windowStart);
    const endDay = startOfUTCDate(windowEnd);
    const map = new Map();
    for (const r of bucketResults) {
      map.set(r.label, Number(r.count || 0));
    }
    while (d.getTime() <= endDay.getTime()) {
      const label = toYMD(d);
      const count = map.get(label) || 0;
      ticks.push({ label, count });
      d = addDays(d, 1);
    }

    const response = {
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
      items,
      buckets: ticks,
    };

    try {
      res.setHeader('x-service-type-count', String(items.length));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[service-type.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
