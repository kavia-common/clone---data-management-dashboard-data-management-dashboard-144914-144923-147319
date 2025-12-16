const express = require('express');
const router = express.Router();
const sessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/service-type/summary
 * Aggregates SessionTracking by date (UTC YYYY-MM-DD) and service_type for a given tenant and time window.
 *
 * Key changes:
 * - Use tenant_id as primary scope (derive from auth/middleware or query). Keep legacy aliases (organizationId/organization_id) by mapping to tenant_id.
 * - Filter strictly by created_at with inclusive bounds computed in UTC ([$gte: startOfDayZ, $lte: endOfDayZ]).
 * - Treat incoming dates as UTC; YYYY-MM-DD => 00:00:00.000Z .. 23:59:59.999Z of that same day.
 * - Group by UTC day and service_type; optionally filter service_type when provided.
 * - Preserve response shape { labels, series, table, summaryByServiceType, meta }.
 * - Zero-fill series only when ?zero_fill=true (default: false).
 *
 * Query:
 * - tenant_id (preferred) OR organizationId/organization_id (legacy aliases)
 * - range: daily|weekly|monthly|custom (default: daily)
 * - startDate/endDate for custom; accepts ISO or YYYY-MM-DD (UTC semantics)
 * - service_type (optional; exact match filter)
 * - zero_fill=true|false (default: false)
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Inputs and aliases, robust parsing
    let {
      range = 'daily',
      startDate, endDate, start_date, end_date, start, end,
      tenant_id, organizationId, organization_id,
      service_type,
      zero_fill,
    } = req.query || {};

    // Normalize range
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Allowed: daily|weekly|monthly|custom" });
    }

    // Resolve tenant: prefer tenant_id then auth context; keep legacy organizationId alias
    // Note: extractOrganization attaches req.organizationId and req.tenantId based on headers/query.
    const effectiveTenant =
      (tenant_id && String(tenant_id)) ||
      req.tenantId ||
      req.organizationId ||
      (organizationId && String(organizationId)) ||
      (organization_id && String(organization_id)) ||
      null;

    // Super-admin global allowed when middleware sets req.allTenants
    if (!effectiveTenant && !req.allTenants) {
      return res.status(400).json({ message: 'tenant_id (or organizationId alias) is required.' });
    }

    // Parse zero_fill flag (default false)
    const zeroFill =
      typeof zero_fill === 'string'
        ? ['1', 'true', 'yes', 'on'].includes(zero_fill.toLowerCase())
        : false;

    // Date helpers (UTC, no double-shift)
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
      /**
       * Parse ISO or YYYY-MM-DD; date-only -> start-of-day for start, end-of-day for end (UTC).
       * Input dates are treated as UTC; we do not apply any local timezone shifts.
       */
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
      // If raw starts with YYYY-MM-DD, normalize to respective bound in UTC
      if (/^\d{4}-\d{2}-\d{2}([ T]|$)/.test(raw)) {
        return which === 'end' ? endOfUTCDate(d) : startOfUTCDate(d);
      }
      return d;
    }

    // Compute time window in UTC with inclusive bounds
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

    // Build match: STRICTLY on created_at with inclusive bounds in UTC
    const match = {
      created_at: { $gte: windowStart, $lte: windowEnd },
    };

    // Tenant scope
    if (!req.allTenants && effectiveTenant) {
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },     // legacy alias
        { organizationId: effectiveTenant },      // legacy alias camelCase
        { tenantId: effectiveTenant },            // defensive
        { orgId: effectiveTenant },               // defensive
        { 'tenant.tenant_id': effectiveTenant },  // nested defensive
      ];
    }

    // Optional service_type filter (exact match against coalesced field)
    // We'll apply it later in $match with $expr against computed coalesced field, so capture here:
    const serviceTypeFilterValue = typeof service_type === 'string' && service_type.trim().length > 0
      ? service_type.trim()
      : null;

    // Coalesce service_type variants and compute bucketDate (truncate created_at)
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

    // Aggregation pipeline: group by date+service_type (date derived from created_at)
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _bucket: { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } },
          _stype: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      ...(serviceTypeFilterValue
        ? [{ $match: { _stype: serviceTypeFilterValue } }]
        : []),
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

    // Totals by service_type (respect same match + optional service_type)
    const totalsPipeline = [
      { $match: match },
      {
        $project: {
          service_type: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      ...(serviceTypeFilterValue
        ? [{ $match: { service_type: serviceTypeFilterValue } }]
        : []),
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

    // Build labels list (only when zero_fill=true; otherwise derive from data)
    const pad2 = (n) => String(n).padStart(2, '0'); // keep pad as pad
    const labels = [];
    if (zeroFill) {
      let d = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate()));
      const endDay = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate()));
      while (d.getTime() <= endDay.getTime()) {
        labels.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    } else {
      // No zero filling: labels based on actual dates present in rows (ascending unique)
      const set = new Set(rows.map(r => r.date));
      labels.push(...Array.from(set).sort());
    }

    // Service types present (respect totals or rows)
    const serviceTypes = new Set((totals || []).map(t => t.service_type));
    for (const r of rows || []) {
      if (r.service_type && !serviceTypes.has(r.service_type)) serviceTypes.add(r.service_type);
      if (!r.service_type) serviceTypes.add('Unknown');
    }

    // Initialize series container
    const seriesMap = {};
    const baseLen = labels.length;
    for (const st of serviceTypes) {
      seriesMap[st] = zeroFill ? new Array(baseLen).fill(0) : [];
    }

    // Fill counts
    if (zeroFill) {
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
    } else {
      // No zero-fill: for each service type create data aligned to labels order by pushing values where date matches, otherwise skip
      // Build per-date map for quick lookup
      const byKey = new Map();
      for (const r of rows || []) {
        const key = `${r.service_type || 'Unknown'}::${r.date}`;
        byKey.set(key, (byKey.get(key) || 0) + Number(r.count || 0));
      }
      for (const st of serviceTypes) {
        for (const label of labels) {
          const val = byKey.get(`${st}::${label}`);
          if (typeof val === 'number') {
            seriesMap[st].push(val);
          } else {
            // leave gap -> treat as 0 to keep chart integrity since frontend expects aligned arrays
            seriesMap[st].push(0);
          }
        }
      }
    }

    // Shape series array
    const series = Object.keys(seriesMap).sort().map(name => ({
      name,
      data: seriesMap[name],
    }));

    // Table rows already shaped
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
        // Backward-compatible meta field name preserved:
        organizationId: effectiveTenant || (req.allTenants ? 'all-tenants' : null),
        // New explicit meta for clarity:
        tenant_id: effectiveTenant || (req.allTenants ? 'all-tenants' : null),
        filters: {
          service_type: serviceTypeFilterValue || null,
          zero_fill: zeroFill,
          field: 'created_at',
        },
      },
    };

    // Helpful headers for diagnostics
    try {
      res.setHeader('x-window-start', payload.meta.startDate);
      res.setHeader('x-window-end', payload.meta.endDate);
      res.setHeader('x-effective-tenant', String(payload.meta.tenant_id || 'unknown'));
      res.setHeader('x-filter-field', 'created_at');
      if (serviceTypeFilterValue) res.setHeader('x-service-type', serviceTypeFilterValue);
    } catch {}

    return res.status(200).json(payload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[service-type.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
