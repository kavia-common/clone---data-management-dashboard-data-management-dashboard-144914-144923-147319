const express = require('express');
const router = express.Router();
const sessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/service-type/summary
 * Aggregates SessionTracking by date (UTC YYYY-MM-DD) and service_type for a given organization and time window.
 *
 * Query:
 * - organizationId (required; aliases: organization_id, tenant_id)
 * - range: daily|weekly|monthly|custom (default: daily)
 * - startDate/endDate for custom; accepts ISO or YYYY-MM-DD
 *
 * Response shape (chart-friendly):
 * {
 *   labels: [ 'YYYY-MM-DD', ... ],                 // all dates in window ascending
 *   series: [ { name: 'service_type', data: [..] } ], // counts aligned to labels; zero-filled
 *   table: [ { date: 'YYYY-MM-DD', service_type: '...', count: 3 }, ... ], // flat rows
 *   summaryByServiceType: [ { service_type: '...', count: 10 }, ... ],     // backward-compatible totals
 *   meta: { range, startDate, endDate, organizationId }
 * }
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Inputs and aliases
    let {
      range = 'daily',
      startDate, endDate, start_date, end_date, start, end,
      organizationId, organization_id, tenant_id
    } = req.query || {};

    // Normalize range
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Allowed: daily|weekly|monthly|custom" });
    }

    // Resolve organization id
    const effectiveTenant =
      organizationId ||
      req.organizationId ||
      req.tenantId ||
      organization_id ||
      tenant_id ||
      null;

    if (!effectiveTenant && !req.allTenants) {
      return res.status(400).json({ message: 'organizationId (tenant) is required.' });
    }

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const isDateOnly = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
    const startOfUTCDate = (d) => new Date(`${ymd(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${ymd(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };
    // PUBLIC_INTERFACE
    function parseFlexibleDate(input, which) {
      /** Parse ISO or YYYY-MM-DD; date-only -> start-of-day for start, end-of-day for end (UTC). */
      if (!input || typeof input !== 'string') return null;
      const raw = input.trim();
      if (!raw) return null;
      if (isDateOnly(raw)) {
        const d = new Date(`${raw}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return null;
        return which === 'end' ? endOfUTCDate(d) : startOfUTCDate(d);
      }
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return null;
      if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(raw)) {
        return which === 'end' ? endOfUTCDate(d) : startOfUTCDate(d);
      }
      return d;
    }

    // Compute time window
    const customStartRaw = startDate || start_date || start || '';
    const customEndRaw = endDate || end_date || end || '';
    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;
    if (range === 'custom') {
      const parsedStart = parseFlexibleDate(customStartRaw, 'start');
      const parsedEnd = parseFlexibleDate(customEndRaw, 'end');
      if (!parsedStart && !parsedEnd) {
        return res.status(400).json({ message: "For range=custom, provide startDate and/or endDate (ISO or YYYY-MM-DD)." });
      }
      if (parsedStart && !parsedEnd) {
        windowStart = parsedStart;
        windowEnd = endOfUTCDate(new Date());
      } else if (!parsedStart && parsedEnd) {
        const startDefault = addDays(parsedEnd, -29);
        windowStart = startOfUTCDate(startDefault);
        windowEnd = parsedEnd;
      } else {
        windowStart = parsedStart;
        windowEnd = parsedEnd;
      }
      if (!windowStart || Number.isNaN(windowStart.getTime())) {
        return res.status(400).json({ message: 'Invalid startDate. Use ISO or YYYY-MM-DD.' });
      }
      if (!windowEnd || Number.isNaN(windowEnd.getTime())) {
        return res.status(400).json({ message: 'Invalid endDate. Use ISO or YYYY-MM-DD.' });
      }
      if (windowStart.getTime() > windowEnd.getTime()) {
        return res.status(400).json({ message: 'startDate must be before or equal to endDate.' });
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

    // Build match: time window across canonical fields
    const timeOr = [
      { last_updated: { $gte: windowStart, $lte: windowEnd } },
      { session_start: { $gte: windowStart, $lte: windowEnd } },
      { timestamp:     { $gte: windowStart, $lte: windowEnd } },
      { createdAt:     { $gte: windowStart, $lte: windowEnd } },
      { created_at:    { $gte: windowStart, $lte: windowEnd } },
    ];
    const match = { $or: timeOr };
    if (!req.allTenants) {
      match.$and = [{
        $or: [
          { tenant_id: effectiveTenant },
          { organization_id: effectiveTenant },
          { organizationId: effectiveTenant },
          { tenantId: effectiveTenant },
          { orgId: effectiveTenant },
          { 'tenant.tenant_id': effectiveTenant },
        ],
      }];
    }

    // Coalesce service_type variants and compute bucketDate
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
    const pickedDate = { $ifNull: ['$last_updated', { $ifNull: ['$session_start', { $ifNull: ['$timestamp', { $ifNull: ['$createdAt', '$created_at'] }] }] }] };

    // Aggregation pipeline: group by date+service_type
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _bucket: {
            $dateTrunc: { date: pickedDate, unit: 'day', timezone: 'UTC' },
          },
          _stype: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      {
        $group: {
          _id: { date: '$_bucket', service_type: '$_stype' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: { $dateToString: { format: '%Y-%m-%d', date: '$_id.date', timezone: 'UTC' } },
          service_type: '$_id.service_type',
          count: 1,
        },
      },
      { $sort: { date: 1, service_type: 1 } },
    ];

    // Also compute totals by service_type (backward-compatible summary)
    const totalsPipeline = [
      { $match: match },
      {
        $project: {
          service_type: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      {
        $group: {
          _id: '$service_type',
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, service_type: '$_id', count: 1 } },
      { $sort: { count: -1, service_type: 1 } },
    ];

    const db = req.app.get('db');
    let rows = [];
    let totals = [];
    if (db && typeof db.collection === 'function') {
      rows = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();
      totals = await db.collection('session_tracking').aggregate(totalsPipeline, { allowDiskUse: true }).toArray();
    } else {
      rows = await sessionTracking.aggregate(pipeline).allowDiskUse(true);
      totals = await sessionTracking.aggregate(totalsPipeline).allowDiskUse(true);
    }

    // Build labels (all dates in window, inclusive)
    const labels = [];
    let d = startOfUTCDate(windowStart);
    const endDay = startOfUTCDate(windowEnd);
    while (d.getTime() <= endDay.getTime()) {
      labels.push(ymd(d));
      d = addDays(d, 1);
    }

    // Collect service types present (from totals) to keep ordering; ensure 'Unknown' if seen in rows
    const serviceTypes = new Set((totals || []).map(t => t.service_type));
    for (const r of rows || []) {
      if (!r.service_type) serviceTypes.add('Unknown');
    }

    // Initialize series map with zeros for each label
    const seriesMap = {};
    for (const st of serviceTypes) {
      seriesMap[st] = new Array(labels.length).fill(0);
    }
    // When no service types exist in totals/rows, return an empty series array (frontend can handle)
    // Fill counts
    const labelIndex = new Map(labels.map((l, i) => [l, i]));
    for (const r of rows || []) {
      const date = r.date;
      const st = r.service_type || 'Unknown';
      if (!seriesMap[st]) {
        seriesMap[st] = new Array(labels.length).fill(0);
      }
      const idx = labelIndex.get(date);
      if (idx !== undefined) {
        seriesMap[st][idx] = (seriesMap[st][idx] || 0) + Number(r.count || 0);
      }
    }

    // Shape series array
    const series = Object.keys(seriesMap).sort().map(name => ({
      name,
      data: seriesMap[name],
    }));

    // Table rows already in desired shape
    const table = rows || [];

    const payload = {
      labels,
      series,
      table,
      summaryByServiceType: totals || [],
      meta: {
        range,
        startDate: windowStart.toISOString(),
        endDate: windowEnd.toISOString(),
        organizationId: effectiveTenant || (req.allTenants ? 'all-tenants' : null),
      },
    };

    // Helpful headers
    try {
      res.setHeader('x-window-start', payload.meta.startDate);
      res.setHeader('x-window-end', payload.meta.endDate);
      res.setHeader('x-effective-tenant', String(payload.meta.organizationId || 'unknown'));
    } catch {}

    return res.status(200).json(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[service-type.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
