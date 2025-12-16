const express = require('express');
const router = express.Router();
const sessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/service-type/summary
 * Aggregates SessionTracking by date (UTC YYYY-MM-DD) and service_type for a given tenant and time window.
 *
 * Behavior:
 * - Default: scope to a single tenant (from middleware/query), group by UTC day + service_type.
 * - Special-case T0000: do NOT scope to a single tenant; aggregate across all tenants for the window.
 *   Group by { service_type, tenant_id }. Return labels as service_types, series grouped by tenant_id
 *   for a horizontal stacked bar. Zero-fill stacks within this special-case only.
 *
 * Query:
 * - tenant_id (preferred) OR organizationId/organization_id (legacy aliases)
 * - range: daily|weekly|monthly|custom (default: daily)
 * - startDate/endDate for custom; accepts ISO or YYYY-MM-DD (UTC semantics)
 * - service_type (optional; exact match filter)
 * - zero_fill=true|false (default: false) — honored for default behavior; for T0000 we zero-fill internally.
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

    // Parse zero_fill flag (default false). Note: for T0000 special-case we always zero-fill stacks.
    const zeroFillFlag =
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

    // Optional service_type filter value
    const serviceTypeFilterValue = typeof service_type === 'string' && service_type.trim().length > 0
      ? service_type.trim()
      : null;

    // Coalesce service_type variants
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

    // -------------------------------
    // SPECIAL-CASE: tenant_id === 'T0000'
    // -------------------------------
    // When tenant is T0000, we do NOT scope to a single tenant. We aggregate across all tenants
    // within the requested window (and optional service_type), and group by { service_type, tenant_id }.
    // Response is optimized for a horizontal stacked bar: labels = service_type[], series = per-tenant stacks.
    const isT0000 = String(effectiveTenant || '').toUpperCase() === 'T0000';

    if (isT0000) {
      const matchAll = {
        created_at: { $gte: windowStart, $lte: windowEnd },
      };

      const db = req.app.get('db');

      // Pipeline 1: group by { service_type, tenant_id }
      const groupPipeline = [
        { $match: matchAll },
        {
          $project: {
            tenant_id: {
              $ifNull: [
                '$tenant_id',
                {
                  $ifNull: ['$organization_id',
                    { $ifNull: ['$organizationId', '$tenantId'] }
                  ]
                }
              ]
            },
            service_type: { $ifNull: [coalescedServiceType, 'Unknown'] },
          }
        },
        ...(serviceTypeFilterValue ? [{ $match: { service_type: serviceTypeFilterValue } }] : []),
        {
          $group: {
            _id: { st: '$service_type', t: '$tenant_id' },
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            service_type: '$_id.st',
            tenant_id: '$_id.t',
            count: 1
          }
        }
      ];

      // Execute aggregation for table and also compute summaryByServiceType across all tenants
      let grouped = [];
      if (db && typeof db.collection === 'function') {
        grouped = await db.collection('session_tracking').aggregate(groupPipeline, { allowDiskUse: true }).toArray();
      } else {
        grouped = await sessionTracking.aggregate(groupPipeline).allowDiskUse(true);
      }

      // Build labels = service_type list (alpha for determinism)
      const stSet = new Set(grouped.map(g => g.service_type || 'Unknown'));
      const labels = Array.from(stSet).sort((a, b) => String(a).localeCompare(String(b)));

      // Build series = per-tenant stacks aligned to labels; zero-fill to complete stacks
      const tenants = Array.from(new Set(grouped.map(g => g.tenant_id).filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b)));

      const labelIndex = new Map(labels.map((l, i) => [l, i]));
      // Map: tenant -> data[]
      const seriesMap = new Map();
      for (const t of tenants) {
        seriesMap.set(t, new Array(labels.length).fill(0));
      }

      // Fill values by aligning to service_type position
      for (const row of grouped) {
        const st = row.service_type || 'Unknown';
        const t = row.tenant_id || 'unknown';
        const idx = labelIndex.get(st);
        if (idx !== undefined) {
          if (!seriesMap.has(t)) {
            seriesMap.set(t, new Array(labels.length).fill(0));
          }
          const arr = seriesMap.get(t);
          arr[idx] = (arr[idx] || 0) + Number(row.count || 0);
        }
      }

      // Convert to array of { name: tenant_id, data: [...] }
      const series = tenants.map(t => ({
        name: t,
        data: seriesMap.get(t) || new Array(labels.length).fill(0),
      }));

      // summaryByServiceType: aggregate across tenants to maintain compatibility
      const summaryByServiceTypeMap = new Map();
      for (const row of grouped) {
        const st = row.service_type || 'Unknown';
        summaryByServiceTypeMap.set(st, (summaryByServiceTypeMap.get(st) || 0) + Number(row.count || 0));
      }
      const summaryByServiceType = Array.from(summaryByServiceTypeMap.entries())
        .map(([service_type, count]) => ({ service_type, count }))
        .sort((a, b) => a.service_type.localeCompare(b.service_type));

      // table: optional flat array { service_type, tenant_id, count }
      const table = grouped;

      const payload = {
        // For horizontal stacked bar, labels are service types
        labels,
        // series grouped by tenant_id, each aligns to labels
        series,
        table,
        summaryByServiceType,
        meta: {
          specialCase: 'T0000',
          range,
          startDate: windowStart.toISOString(),
          endDate: windowEnd.toISOString(),
          organizationId: 'all-tenants',
          tenant_id: 'all-tenants',
          filters: {
            service_type: serviceTypeFilterValue || null,
            // zeroFill behavior: default false globally, but for T0000 we zero-fill internally to ensure proper stacks.
            zero_fill: true,
            field: 'created_at',
          },
        },
      };

      try {
        res.setHeader('x-window-start', payload.meta.startDate);
        res.setHeader('x-window-end', payload.meta.endDate);
        res.setHeader('x-effective-tenant', 'all-tenants');
        res.setHeader('x-filter-field', 'created_at');
        res.setHeader('x-special-case', 'T0000');
        if (serviceTypeFilterValue) res.setHeader('x-service-type', serviceTypeFilterValue);
      } catch {}

      return res.status(200).json(payload);
    }

    // -------------------------------
    // DEFAULT BEHAVIOR (tenant-specific)
    // -------------------------------

    // Build match: STRICTLY on created_at with inclusive bounds in UTC
    const match = {
      created_at: { $gte: windowStart, $lte: windowEnd },
    };

    // Tenant scope (unchanged behavior): only when not global and tenant present
    if (!req.allTenants && effectiveTenant) {
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },
        { organizationId: effectiveTenant },
        { tenantId: effectiveTenant },
        { orgId: effectiveTenant },
        { 'tenant.tenant_id': effectiveTenant },
      ];
    } else if (!effectiveTenant && !req.allTenants) {
      // Keep previous requirement for tenant when not global
      return res.status(400).json({ message: 'tenant_id (or organizationId alias) is required.' });
    }

    // Aggregation pipeline: group by date+service_type for time series per service type
    const pipeline = [
      { $match: match },
      {
        $addFields: {
          _bucket: { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } },
          _stype: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      ...(serviceTypeFilterValue ? [{ $match: { _stype: serviceTypeFilterValue } }] : []),
      { $group: { _id: { date: '$_bucket', service_type: '$_stype' }, count: { $sum: 1 } } },
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

    const totalsPipeline = [
      { $match: match },
      {
        $project: {
          service_type: { $ifNull: [coalescedServiceType, 'Unknown'] },
        },
      },
      ...(serviceTypeFilterValue ? [{ $match: { service_type: serviceTypeFilterValue } }] : []),
      { $group: { _id: '$service_type', count: { $sum: 1 } } },
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

    // Build labels list (zero-fill only when requested)
    const pad2 = (n) => String(n).padStart(2, '0');
    const labels = [];
    if (zeroFillFlag) {
      let d = new Date(Date.UTC(windowStart.getUTCFullYear(), windowStart.getUTCMonth(), windowStart.getUTCDate()));
      const endDay = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth(), windowEnd.getUTCDate()));
      while (d.getTime() <= endDay.getTime()) {
        labels.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    } else {
      const set = new Set(rows.map(r => r.date));
      labels.push(...Array.from(set).sort());
    }

    const serviceTypes = new Set((totals || []).map(t => t.service_type));
    for (const r of rows || []) {
      if (r.service_type && !serviceTypes.has(r.service_type)) serviceTypes.add(r.service_type);
      if (!r.service_type) serviceTypes.add('Unknown');
    }

    const seriesMap = {};
    const baseLen = labels.length;
    for (const st of serviceTypes) {
      seriesMap[st] = zeroFillFlag ? new Array(baseLen).fill(0) : [];
    }

    if (zeroFillFlag) {
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
      const byKey = new Map();
      for (const r of rows || []) {
        const key = `${r.service_type || 'Unknown'}::${r.date}`;
        byKey.set(key, (byKey.get(key) || 0) + Number(r.count || 0));
      }
      for (const st of serviceTypes) {
        for (const label of labels) {
          const val = byKey.get(`${st}::${label}`);
          seriesMap[st].push(typeof val === 'number' ? val : 0);
        }
      }
    }

    const series = Object.keys(seriesMap).sort().map(name => ({
      name,
      data: seriesMap[name],
    }));

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
        tenant_id: effectiveTenant || (req.allTenants ? 'all-tenants' : null),
        filters: {
          service_type: serviceTypeFilterValue || null,
          zero_fill: zeroFillFlag,
          field: 'created_at',
        },
      },
    };

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
