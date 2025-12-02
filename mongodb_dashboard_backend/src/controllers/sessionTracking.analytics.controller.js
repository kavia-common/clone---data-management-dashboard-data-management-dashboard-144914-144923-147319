'use strict';

// Note: computeDuration helper was intentionally omitted (unused) to satisfy linter/build.
const SessionTracking = require('../models/sessionTracking.model');
const { success, failure } = require('../utils/http');
const { isValidISODate, parseISODateSafe, startOfDayUTC } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * buildDateRange
 * Normalize start/end date range based on interval and defaults:
 * - daily: last 30 days
 * - weekly: last 12 weeks
 * - monthly: last 12 months
 * - custom: requires start & end
 */
function buildDateRange(interval, startStr, endStr) {
  const now = new Date();
  let start, end;

  const clampEndToUTCDayEnd = (d) => {
    const e = new Date(d);
    e.setUTCHours(23, 59, 59, 999);
    return e;
  };

  if (interval === 'custom') {
    if (!isValidISODate(startStr) || !isValidISODate(endStr)) {
      return { error: 'When interval=custom, valid ISO start and end are required.' };
    }
    start = startOfDayUTC(parseISODateSafe(startStr));
    end = clampEndToUTCDayEnd(parseISODateSafe(endStr));
    if (start > end) {
      const t = start;
      start = end;
      end = t;
    }
    return { start, end };
  }

  if (isValidISODate(startStr)) start = startOfDayUTC(parseISODateSafe(startStr));
  if (isValidISODate(endStr)) end = clampEndToUTCDayEnd(parseISODateSafe(endStr));

  const todayEnd = clampEndToUTCDayEnd(now);

  if (interval === 'weekly') {
    // Default: last 12 weeks
    if (!end) end = todayEnd;
    if (!start) {
      const s = new Date(end);
      s.setUTCDate(end.getUTCDate() - (12 * 7 - 1));
      start = startOfDayUTC(s);
    }
  } else if (interval === 'monthly') {
    // Default: last 12 months (approx 365 days)
    if (!end) end = todayEnd;
    if (!start) {
      const s = new Date(end);
      s.setUTCMonth(s.getUTCMonth() - 11);
      s.setUTCDate(1);
      start = startOfDayUTC(s);
    }
  } else {
    // daily default: last 30 days
    if (!end) end = todayEnd;
    if (!start) {
      const s = new Date(end);
      s.setUTCDate(end.getUTCDate() - 29);
      start = startOfDayUTC(s);
    }
  }

  return { start, end };
}

/**
 * PUBLIC_INTERFACE
 * getSessionTrackingAggregates
 * GET /api/session-tracking?interval=...&start=...&end=...
 * Aggregates session_tracking by session_start using $dateTrunc for day/week/month/custom.
 * Response: { interval, start, end, data: [ { date: ISOString, count } ], total }
 */
async function getSessionTrackingAggregates(req, res) {
  try {
    // Interval validation
    const rawInterval = String(req.query.interval || 'daily').toLowerCase();
    const allowed = ['daily', 'weekly', 'monthly', 'custom'];
    const interval = allowed.includes(rawInterval) ? rawInterval : 'daily';

    // Date range
    const { start, end, error } = buildDateRange(interval, req.query.start, req.query.end);
    if (error) return failure(res, error, 400);

    // Tenant scope: requireTenant sets req.tenantId unless super admin bypass
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin);
    const tenantId = req.tenantId;

    if (!bypass && !tenantId) {
      return failure(res, 'tenant_id is required', 400);
    }

    // Compose $match
    const match = {
      session_start: { $gte: start, $lte: end },
    };
    if (!bypass && tenantId) {
      match.$or = [
        { tenant_id: tenantId },
        { organization_id: tenantId },
        { organizationId: tenantId },
      ];
    }

    // Determine unit for dateTrunc
    let unit = 'day';
    if (interval === 'weekly') unit = 'week';
    if (interval === 'monthly') unit = 'month';
    // For custom, still bucket by day as requested
    if (interval === 'custom') unit = 'day';

    // Aggregation pipeline
    /** @type {import('mongoose').PipelineStage[]} */
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$session_start',
              unit,
              timezone: 'UTC',
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ];

    const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    const data = rows.map((r) => ({
      date: new Date(r._id).toISOString(),
      count: r.count || 0,
    }));
    const total = data.reduce((a, b) => a + (b.count || 0), 0);

    // Debug headers
    try {
      res.set('X-Session-Tracking-Interval', interval);
      res.set('X-Session-Tracking-Match', JSON.stringify({ ...match, session_start: '[omitted]' }));
    } catch {}

    return success(
      res,
      data,
      {
        interval,
        start: start.toISOString(),
        end: end.toISOString(),
        total,
      },
      200
    );
  } catch (err) {
    return failure(res, err?.message || 'Aggregation failed', 500);
  }
}

/**
 * PUBLIC_INTERFACE
 * getSessionTrackingRaw
 * GET /api/session-tracking/raw?start=&end=
 * Returns minimally projected raw documents for verification: session_start, user_id, tenant_id.
 */
async function getSessionTrackingRaw(req, res) {
  try {
    const startQ = req.query.start;
    const endQ = req.query.end;

    if (!isValidISODate(startQ) || !isValidISODate(endQ)) {
      return failure(res, 'Valid ISO start and end are required for raw view', 400);
    }

    const start = startOfDayUTC(parseISODateSafe(startQ));
    const end = new Date(parseISODateSafe(endQ));
    end.setUTCHours(23, 59, 59, 999);

    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin);
    const tenantId = req.tenantId;

    if (!bypass && !tenantId) {
      return failure(res, 'tenant_id is required', 400);
    }

    const match = {
      session_start: { $gte: start, $lte: end },
    };
    if (!bypass && tenantId) {
      match.$or = [
        { tenant_id: tenantId },
        { organization_id: tenantId },
        { organizationId: tenantId },
      ];
    }

    const rows = await SessionTracking.find(match, {
      session_start: 1,
      user_id: 1,
      tenant_id: 1,
      organization_id: 1,
      organizationId: 1,
    })
      .sort({ session_start: 1 })
      .limit(5000)
      .lean();

    return success(res, rows, { start: start.toISOString(), end: end.toISOString(), total: rows.length }, 200);
  } catch (err) {
    return failure(res, err?.message || 'Raw fetch failed', 500);
  }
}

module.exports = {
  getSessionTrackingAggregates,
  getSessionTrackingRaw,
  buildDateRange,
};
