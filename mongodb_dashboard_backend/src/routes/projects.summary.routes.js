'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Project = require('../models/project.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Summary: Aggregates project counts grouped by created_at with support for daily, weekly, monthly, and custom ranges.
 * Description:
 *   - Determines organization/tenant scope from:
 *       1) Auth context (if middleware sets req.organizationId/tenantId),
 *       2) Header x-organization-id,
 *       3) Query ?organization_id or ?tenant_id
 *     Super Admin may have global (all-tenant) scope; in such case, no tenant filter is applied.
 *
 *   - For range:
 *       daily   -> today only (UTC)
 *       weekly  -> last 7 days including today (UTC)
 *       monthly -> last 30 days including today (UTC)
 *       custom  -> requires start_date and end_date (YYYY-MM-DD), inclusive
 *
 *   - Buckets are returned sorted ascending and include:
 *       { key, label, count }
 *     Where key is the normalized date string 'YYYY-MM-DD' for day buckets.
 *
 * Query parameters:
 *   - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 *   - start_date: YYYY-MM-DD (required when range=custom)
 *   - end_date: YYYY-MM-DD (required when range=custom)
 *   - organization_id: string (alias tenant_id). Used only when not authenticated; header takes precedence.
 *
 * Response 200:
 *   {
 *     range: 'daily'|'weekly'|'monthly'|'custom',
 *     start_date: 'YYYY-MM-DD',
 *     end_date: 'YYYY-MM-DD',
 *     buckets: [{ key: 'YYYY-MM-DD', label: 'YYYY-MM-DD', count: number }]
 *   }
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Parse query params
    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({
        message: "Invalid 'range'. Allowed values: daily|weekly|monthly|custom.",
      });
    }

    // Determine tenant scope
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;
    const effectiveTenant = req.organizationId || req.tenantId;

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({
        message:
          'organization_id is required (use header x-organization-id or ?organization_id=...)',
      });
    }

    // Date helpers (UTC normalized)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };

    // Compute window
    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;
    const reDate = /^\d{4}-\d{2}-\d{2}$/;

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({
          message:
            "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD.",
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

    // Build match with tenant scope
    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };
    if (!isGlobal && effectiveTenant) {
      match.$or = [
        { tenant_id: String(effectiveTenant) },
        { organization_id: String(effectiveTenant) },
        { organizationId: String(effectiveTenant) },
        { tenantId: String(effectiveTenant) },
        { orgId: String(effectiveTenant) },
        { 'tenant.tenant_id': String(effectiveTenant) },
      ];
    }

    // Build aggregation - prefer $dateTrunc for day buckets
    const bucketExpr = { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } };

    const basePipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketExpr } },
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

    // Use native db if available (set in config/db), else Mongoose aggregate
    const db = req.app.get('db');

    let results = [];
    if (db && typeof db.collection === 'function') {
      results = await db.collection('projects').aggregate(basePipeline, { allowDiskUse: true }).toArray();
    } else {
      results = await Project.aggregate(basePipeline).allowDiskUse(true);
    }

    // Create complete contiguous daily buckets and zero-fill
    const ticks = [];
    let d = startOfUTCDate(windowStart);
    const endDay = startOfUTCDate(windowEnd);
    while (d.getTime() <= endDay.getTime()) {
      ticks.push(new Date(d));
      d = addDays(d, 1);
    }
    const map = new Map();
    for (const r of results) {
      const k = typeof r.label === 'string' ? r.label : toYMD(new Date(r.start));
      map.set(k, Number(r.count || 0));
    }
    const buckets = ticks.map((t) => {
      const label = toYMD(t);
      return {
        key: label,
        label,
        count: Number(map.get(label) || 0),
      };
    });

    // Build response
    const response = {
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
      buckets,
    };
    try {
      res.set('Cache-Control', 'no-store');
      if (effectiveTenant) res.set('x-effective-tenant', String(effectiveTenant));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
