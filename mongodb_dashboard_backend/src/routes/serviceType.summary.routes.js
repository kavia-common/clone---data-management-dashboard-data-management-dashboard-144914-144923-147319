const express = require('express');
const router = express.Router();
const sessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/service-type/summary
 * Aggregates session_tracking by service_type over a selected time window (daily|weekly|monthly|custom).
 *
 * Query params (all via query):
 * - organizationId: required (alias: organization_id or tenant_id)
 * - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 * - startDate, endDate (ISO strings) required when range='custom'
 *
 * Behavior changes in this version:
 * - organizationId is required; request returns 400 when missing.
 * - Date range is computed based on 'range'. For custom, use provided startDate/endDate (ISO).
 * - Filters session_tracking by organizationId and createdAt window (prefers last_updated, then session_start, then timestamp).
 * - Groups by service_type and returns counts. If service_type is null/absent, grouped as 'Unknown'.
 * - When no records match, returns items: [] and buckets: [] (or zero-filled series for the date range).
 *
 * Returns 200 JSON:
 * {
 *   range,
 *   startDate,
 *   endDate,
 *   items: [{ service_type: string, count: number }],
 *   buckets: [{ label: 'YYYY-MM-DD', count: number }] // contiguous daily ticks for the window
 * }
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    let {
      range = 'daily',
      // Accept multiple aliases for custom dates
      startDate,
      endDate,
      start_date,
      end_date,
      start,
      end,
      organizationId,
      organization_id,
      tenant_id
    } = req.query || {};

    // Normalize range
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({
        message: "Invalid 'range'. Allowed values: daily|weekly|monthly|custom.",
      });
    }

    // Determine and validate required organizationId (required unless super admin bypassed it in middleware)
    const effectiveTenant =
      organizationId ||
      req.organizationId || // extractOrganization attaches this when not super admin
      req.tenantId ||
      organization_id ||
      tenant_id ||
      null;

    if (!effectiveTenant && !req.allTenants) {
      // Keep org required when not super admin
      return res.status(400).json({ message: 'organizationId (tenant) is required.' });
    }

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const isDateOnly = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };

    // Helper: safely parse date input in ISO or date-only and return a Date or null
    // PUBLIC_INTERFACE
    function parseFlexibleDate(input, which) {
      /** Parse ISO or YYYY-MM-DD; date-only interpreted as start-of-day for start and end-of-day for end (UTC). */
      if (!input || typeof input !== 'string') return null;
      const raw = input.trim();
      if (!raw) return null;

      // Support date-only
      if (isDateOnly(raw)) {
        const d = new Date(`${raw}T00:00:00.000Z`);
        if (Number.isNaN(d.getTime())) return null;
        return which === 'end' ? endOfUTCDate(d) : startOfUTCDate(d);
      }

      // Fallback to native Date parse for ISO-like strings
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return null;

      // If only a date part exists but not strictly matched, still normalize to day bounds
      if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(raw)) {
        return which === 'end' ? endOfUTCDate(d) : startOfUTCDate(d);
      }
      return d;
    }

    // Consolidate custom range input aliases (startDate|start_date|start, endDate|end_date|end)
    const customStartRaw = startDate || start_date || start || '';
    const customEndRaw = endDate || end_date || end || '';

    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;

    if (range === 'custom') {
      // For range=custom, parse provided dates with flexibility
      const parsedStart = parseFlexibleDate(customStartRaw, 'start');
      const parsedEnd = parseFlexibleDate(customEndRaw, 'end');

      // If both missing or invalid -> 400 with helpful message
      if (!parsedStart && !parsedEnd) {
        return res.status(400).json({
          message:
            "For range=custom, provide startDate and/or endDate. Accepted: ISO or YYYY-MM-DD. When only one is provided, the other is inferred (end defaults to 'now').",
        });
      }

      // If only one provided, infer the other:
      // - If only start provided -> end = now (end-of-day semantics when date-only)
      // - If only end provided -> start = end - 30 days (sensible default window)
      if (parsedStart && !parsedEnd) {
        // Default end to now (UTC current time, but we normalize to end-of-day to align with date bucket logic)
        const now = new Date();
        windowStart = parsedStart;
        windowEnd = endOfUTCDate(now);
      } else if (!parsedStart && parsedEnd) {
        // Sensible default for start when only end is provided: last 30 days inclusive
        const startDefault = addDays(parsedEnd, -29); // 30 days inclusive (end - 29 to include end day)
        windowStart = startOfUTCDate(startDefault);
        windowEnd = parsedEnd;
      } else {
        windowStart = parsedStart;
        windowEnd = parsedEnd;
      }

      // Defensive checks
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

    // Build filter: prefer last_updated, fallback to session_start, then timestamp
    const timeOr = [
      { last_updated: { $gte: windowStart, $lte: windowEnd } },
      { session_start: { $gte: windowStart, $lte: windowEnd } },
      { timestamp: { $gte: windowStart, $lte: windowEnd } },
    ];
    const match = { $or: timeOr };

    // Required tenant filter (skip when allTenants=true, e.g., super admin bypass)
    if (!req.allTenants) {
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

    // service_type field coalescing
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

    // Daily buckets for time series display consistency
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
      startDate: windowStart.toISOString(),
      endDate: windowEnd.toISOString(),
      items: Array.isArray(items) ? items : [],
      buckets: Array.isArray(ticks) ? ticks : [],
    };

    // Minimal diagnostics/defensive headers
    try {
      res.setHeader('x-service-type-count', String(items.length));
      res.setHeader('x-window-start', response.startDate);
      res.setHeader('x-window-end', response.endDate);
      if (range === 'custom') {
        res.setHeader('x-custom-input-start', String(customStartRaw || ''));
        res.setHeader('x-custom-input-end', String(customEndRaw || ''));
      }
      if (effectiveTenant) {
        res.setHeader('x-effective-tenant', String(effectiveTenant));
      } else if (req.allTenants) {
        res.setHeader('x-effective-tenant', 'all-tenants');
      }
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[service-type.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
