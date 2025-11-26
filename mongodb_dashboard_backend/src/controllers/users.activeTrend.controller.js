'use strict';

/**
// PUBLIC_INTERFACE
 * getUsersActiveTrendController
 * GET /api/analytics/users/active-trend
 * Returns time-bucketed counts of distinct active users based on session_tracking.
 * Query:
 *  - from: ISO start (inclusive). Default: 30 days ago
 *  - to: ISO end (inclusive). Default: now
 *  - granularity: day|week|month (default: day)
 *  - status: optional statuses pipe-separated (default: completed|active)
 * Scoping:
 *  - Enforces tenant scoping unless super-admin/T0000 bypass is detected via upstream middleware flags.
 * Response:
 *  200: { labels: [YYYY-MM-DD...], datasets:[{label:'Active Users', data:[...]}], meta:{ from,to,granularity } }
 */
const SessionTracking = require('../models/sessionTracking.model');
const { addDaysUTC, startOfDayUTC, formatYYYYMMDD } = require('../utils/date');

function parseDateOrDefault(value, fallback) {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

function resolveRange(from, to) {
  const now = new Date();
  const end = parseDateOrDefault(to, now);
  const start = parseDateOrDefault(from, addDaysUTC(end, -29)); // 30 days window
  const fromUtc = startOfDayUTC(start);
  const toUtc = new Date(startOfDayUTC(end).getTime() + (24 * 60 * 60 * 1000) - 1); // inclusive end-of-day
  return { fromUtc, toUtc };
}

function normalizeGranularity(g) {
  const v = String(g || 'day').toLowerCase();
  if (['day', 'week', 'month'].includes(v)) return v;
  if (v === 'weekly') return 'week';
  if (v === 'monthly') return 'month';
  return 'day';
}

function computeDateField() {
  // Prefer last_updated, then session_end, then timestamp, then session_start
  return { $ifNull: ['$last_updated', { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] }] };
}

function buildBucketStage(granularity) {
  const dateField = computeDateField();
  if (granularity === 'week') {
    return {
      $group: {
        _id: {
          $dateTrunc: { date: dateField, unit: 'week', binSize: 1, timezone: 'UTC' },
        },
        users: { $addToSet: { $toString: '$user_id' } },
      },
    };
  }
  if (granularity === 'month') {
    return {
      $group: {
        _id: {
          y: { $year: { date: dateField } },
          m: { $month: { date: dateField } },
        },
        users: { $addToSet: { $toString: '$user_id' } },
      },
    };
  }
  // day
  return {
    $group: {
      _id: {
        y: { $year: { date: dateField } },
        m: { $month: { date: dateField } },
        d: { $dayOfMonth: { date: dateField } },
      },
      users: { $addToSet: { $toString: '$user_id' } },
    },
  };
}

function projectLabelStage(granularity) {
  if (granularity === 'week') {
    return {
      $project: {
        _id: 0,
        label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
        total: { $size: '$users' },
      },
    };
  }
  if (granularity === 'month') {
    return {
      $project: {
        _id: 0,
        label: {
          $concat: [
            { $toString: '$_id.y' }, '-',
            { $toString: { $cond: [{ $gte: ['$_id.m', 10] }, '$_id.m', { $concat: ['0', { $toString: '$_id.m' }] }] } },
            '-01',
          ],
        },
        total: { $size: '$users' },
      },
    };
  }
  return {
    $project: {
      _id: 0,
      label: {
        $concat: [
          { $toString: '$_id.y' }, '-',
          { $toString: { $cond: [{ $gte: ['$_id.m', 10] }, '$_id.m', { $concat: ['0', { $toString: '$_id.m' }] }] } },
          '-',
          { $toString: { $cond: [{ $gte: ['$_id.d', 10] }, '$_id.d', { $concat: ['0', { $toString: '$_id.d' }] }] } },
        ],
      },
      total: { $size: '$users' },
    },
  };
}

// PUBLIC_INTERFACE
async function getUsersActiveTrendController(req, res) {
  try {
    const granularity = normalizeGranularity(req.query?.granularity || 'day');
    const statusParam = (req.query?.status || 'completed|active').trim();
    const { fromUtc, toUtc } = resolveRange(req.query?.from, req.query?.to);

    // Determine tenant scope with bypass support (T0000)
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.analyticsAllTenantsBypass);
    let tenantId = null;
    if (!bypass) {
      tenantId =
        req.tenantId ||
        req.organizationId ||
        (req.auth && req.auth.tenantId ? String(req.auth.tenantId) : null) ||
        (typeof req.headers?.['x-organization-id'] === 'string' ? req.headers['x-organization-id'] : null) ||
        (typeof req.query?.organization_id === 'string' ? req.query.organization_id : null) ||
        (typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : null);
      if (tenantId) tenantId = String(tenantId);
    } else {
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
    }

    const match = {
      $expr: {
        $and: [
          { $gte: [computeDateField(), fromUtc] },
          { $lte: [computeDateField(), toUtc] },
        ],
      },
    };
    if (!bypass && tenantId) {
      match.$or = [
        { tenant_id: tenantId },
        { organization_id: tenantId },
        { tenantId: tenantId },
        { organizationId: tenantId },
        { 'tenant.tenant_id': tenantId },
      ];
    }
    if (statusParam) {
      match.status = statusParam.includes('|')
        ? { $in: statusParam.split('|').map((s) => s.trim()) }
        : statusParam;
    }

    const pipeline = [
      { $match: match },
      buildBucketStage(granularity),
      projectLabelStage(granularity),
      { $sort: { label: 1 } },
    ];

    const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Fill missing buckets
    const labels = [];
    const dataByLabel = new Map(rows.map((r) => [String(r.label), Number(r.total || 0)]));

    if (granularity === 'month') {
      const cursor = new Date(Date.UTC(fromUtc.getUTCFullYear(), fromUtc.getUTCMonth(), 1));
      const end = new Date(Date.UTC(toUtc.getUTCFullYear(), toUtc.getUTCMonth(), 1));
      while (cursor <= end) {
        const label = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-01`;
        labels.push(label);
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else if (granularity === 'week') {
      const existing = rows.map((r) => r.label).sort();
      if (existing.length) {
        let c = new Date(`${existing[0]}T00:00:00.000Z`);
        const last = new Date(`${existing[existing.length - 1]}T00:00:00.000Z`);
        while (c <= last) {
          labels.push(formatYYYYMMDD(c));
          c = addDaysUTC(c, 7);
        }
      } else {
        let c = new Date(fromUtc);
        const end = new Date(toUtc);
        while (c <= end) {
          labels.push(formatYYYYMMDD(c));
          c = addDaysUTC(c, 7);
        }
      }
    } else {
      let c = new Date(fromUtc);
      const end = new Date(toUtc);
      while (c <= end) {
        labels.push(formatYYYYMMDD(c));
        c = addDaysUTC(c, 1);
      }
    }

    const data = labels.map((l) => Number(dataByLabel.get(l) || 0));

    return res.status(200).json({
      labels,
      datasets: [{ label: 'Active Users', data }],
      meta: { from: fromUtc.toISOString(), to: toUtc.toISOString(), granularity },
    });
  } catch (err) {
    console.error('[analytics.users.active-trend] error:', err?.message || err);
    return res.status(500).json({ error: 'Failed to aggregate active users trend' });
  }
}

module.exports = {
  getUsersActiveTrendController,
};
