'use strict';

/**
 * Overview analytics controller
 * Provides time series for: Sessions Trend, Users Trend, Costs Trend.
 *
 * Endpoints are consumed by routes under /api/overview and /api/analytics/overview.
 *
 * PUBLIC INTERFACES:
 * - getSessionsTrend
 * - getUsersTrend
 * - getCostsTrend
 */

const { getDb } = require('../config/db');

// Light-weight date helpers without extra deps
function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function startOfWeek(d) {
  const x = startOfDay(d);
  // ISO week (Mon as start). JS getUTCDay: 0=Sun..6=Sat
  const day = x.getUTCDay() || 7; // Sunday -> 7
  if (day > 1) x.setUTCDate(x.getUTCDate() - (day - 1));
  return x;
}
function startOfMonth(d) {
  const x = startOfDay(d);
  x.setUTCDate(1);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function addWeeks(d, n) {
  return addDays(d, n * 7);
}
function addMonths(d, n) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}
function toISODate(d) {
  // YYYY-MM-DD via UTC
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/**
 * Formats a date to YYYY-MM string (UTC) representing month bucket label.
 */
function toISOMonth(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
function normalizeGranularity(g) {
  return ['day', 'week', 'month'].includes(g) ? g : 'day';
}
function buildBuckets(from, to, granularity) {
  const buckets = [];
  let cursor;
  let stepFn;

  // Normalize the lower bound to a bucket boundary for consistent labels
  if (granularity === 'week') {
    cursor = startOfWeek(from);
    stepFn = (d) => addWeeks(d, 1);
  } else if (granularity === 'month') {
    cursor = startOfMonth(from);
    stepFn = (d) => addMonths(d, 1);
  } else {
    cursor = startOfDay(from);
    stepFn = (d) => addDays(d, 1);
  }

  // Generate bucket labels up to (but not including) 'to'
  while (cursor < to) {
    if (granularity === 'month') {
      buckets.push(toISOMonth(cursor)); // YYYY-MM
    } else {
      buckets.push(toISODate(cursor)); // YYYY-MM-DD
    }
    cursor = stepFn(cursor);
  }
  // Defensive: if range spans no whole buckets (e.g., within same day or month),
  // still emit a single bucket for the normalized 'from' boundary.
  if (buckets.length === 0) {
    if (granularity === 'month') {
      buckets.push(toISOMonth(startOfMonth(from)));
    } else if (granularity === 'week') {
      buckets.push(toISODate(startOfWeek(from)));
    } else {
      buckets.push(toISODate(startOfDay(from)));
    }
  }
  return buckets;
}
function bucketKey(dateOrString, granularity) {
  const d = typeof dateOrString === 'string' ? toDate(dateOrString) : new Date(dateOrString);
  if (!d) return null;
  if (granularity === 'week') return toISODate(startOfWeek(d));
  if (granularity === 'month') return toISOMonth(startOfMonth(d)); // YYYY-MM
  return toISODate(startOfDay(d));
}

// PUBLIC_INTERFACE
async function getSessionsTrend(req, res, next) {
  /**
   * Returns Sessions Trend time series.
   * Query:
   * - from, to (ISO)
   * - granularity: day|week|month
   * - status (optional pipe-separated) default: completed|active
   * Behavior:
   * - Counts sessions whose active window overlaps the range [from,to].
   *   session_start and session_end (null treated as now).
   * - A session contributes to each bucket it spans between max(session_start, from) and min(session_end||now, to).
   */
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not connected' });

    const now = new Date();
    const from = toDate(req.query.from) || startOfDay(addDays(now, -30));
    const to = toDate(req.query.to) || now;
    if (!(from instanceof Date) || !(to instanceof Date) || +from >= +to) {
      return res.status(400).json({ error: 'Invalid from/to' });
    }
    const granularity = normalizeGranularity(String(req.query.granularity || 'day'));
    const statusFilter = String(req.query.status || 'completed|active')
      .split('|')
      .filter(Boolean);

    const buckets = buildBuckets(from, to, granularity);
    const series = Object.fromEntries(buckets.map((b) => [b, 0]));

    const match = {
      $expr: {
        $and: [
          { $lt: ['$session_start', to] },
          {
            $gte: [{ $ifNull: ['$session_end', now] }, from],
          },
        ],
      },
    };
    if (statusFilter.length) {
      match.status = { $in: statusFilter };
    }
    // Tenant scope if middleware set
    if (req.tenantScope && req.tenantScope.tenant_id) {
      match.tenant_id = req.tenantScope.tenant_id;
    }

    const cursor = db.collection('session_tracking').find(match, {
      projection: { session_start: 1, session_end: 1, status: 1 },
    });

    // Iterate doc spans and increment all spanned bucket starts
    for await (const doc of cursor) {
      const s = doc.session_start ? new Date(doc.session_start) : null;
      const e = doc.session_end ? new Date(doc.session_end) : now;
      if (!s) continue;

      const effStart = s < from ? from : s;
      const effEnd = e > to ? to : e;
      if (+effStart >= +effEnd) continue;

      let bStart =
        granularity === 'week'
          ? startOfWeek(effStart)
          : granularity === 'month'
          ? startOfMonth(effStart)
          : startOfDay(effStart);

      const step =
        granularity === 'week'
          ? (d) => addWeeks(d, 1)
          : granularity === 'month'
          ? (d) => addMonths(d, 1)
          : (d) => addDays(d, 1);

      while (bStart < effEnd && bStart < to) {
        const key = toISODate(bStart);
        if (series[key] !== undefined) series[key] += 1;
        bStart = step(bStart);
      }
    }

    return res.json({
      items: buckets.map((b) => ({ date: b, total: series[b] || 0 })),
      meta: { granularity, from: from.toISOString(), to: to.toISOString() },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * PUBLIC_INTERFACE
 * getUsersTrend
 * Returns Users Trend time series strictly filtered by created_at and updated_at within [from, to].
 * Controller validates params and supports granularity day|week|month, optional tenant scope.
 * Response shape (backward compatible + extended):
 *  - { success: true, granularity, from, to, series: [ { bucket, createdCount, updatedCount } ] }
 * Notes:
 *  - We do not exclude deleted users unless explicitly filtered by query via status, but by default we include all.
 *  - Buckets include zero counts for continuity.
 */
async function getUsersTrend(req, res, next) {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not connected' });

    // Parse and validate range
    const now = new Date();
    const from = toDate(req.query.from) || startOfDay(addDays(now, -30));
    const to = toDate(req.query.to) || now;
    if (!(from instanceof Date) || isNaN(from.getTime()) || !(to instanceof Date) || isNaN(to.getTime()) || +from > +to) {
      return res.status(400).json({ success: false, message: 'Invalid from/to. Expect ISO strings where from <= to.' });
    }
    const granularity = normalizeGranularity(String(req.query.granularity || 'day'));
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;

    // Build empty buckets
    const buckets = buildBuckets(from, to, granularity);
    const seriesMap = Object.fromEntries(buckets.map((b) => [b, { createdCount: 0, updatedCount: 0 }]));

    // Base tenant/organization scoping if provided by middleware or explicit query aliases
    const baseMatch = {};
    // Prefer middleware tenant scope
    if (req.tenantScope && req.tenantScope.tenant_id) {
      baseMatch.tenant_id = req.tenantScope.tenant_id;
    }
    // Allow optional organization_id/tenant_id in query if present (demo mode)
    if (!baseMatch.tenant_id) {
      const qTenant = req.query.tenant_id || req.query.organization_id;
      if (qTenant) baseMatch.tenant_id = String(qTenant);
    }

    // Optional status filter; default is to include all statuses (do not exclude deleted unless requested)
    if (status) {
      baseMatch.status = { $in: status.split('|').filter(Boolean) };
    }

    // We'll fetch only fields needed and restrict to docs that have either created_at or updated_at in [from,to]
    const match = {
      ...baseMatch,
      $or: [
        { created_at: { $gte: from, $lte: to } },
        { updated_at: { $gte: from, $lte: to } },
      ],
    };

    // Aggregation approach to avoid client-side iteration over entire collection
    // We produce two streams: one for created_at and one for updated_at, then merge on the server.
    const usersCol = db.collection('users');

    // Pipeline for created_at
    const createdPipeline = [
      { $match: match },
      { $project: { created_at: 1 } },
      { $match: { created_at: { $ne: null } } },
      {
        $addFields: {
          bucket: granularity === 'month'
            ? {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$created_at',
                  timezone: 'UTC',
                },
              }
            : granularity === 'week'
            ? {
                // Week buckets align to ISO week start (Monday) via dateTrunc
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: { $dateTrunc: { date: '$created_at', unit: 'week', binSize: 1, timezone: 'UTC' } },
                  timezone: 'UTC',
                },
              }
            : {
                $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } }, timezone: 'UTC' },
              },
        },
      },
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ];

    // Pipeline for updated_at
    const updatedPipeline = [
      { $match: match },
      { $project: { updated_at: 1 } },
      { $match: { updated_at: { $ne: null } } },
      {
        $addFields: {
          bucket: granularity === 'month'
            ? {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$updated_at',
                  timezone: 'UTC',
                },
              }
            : granularity === 'week'
            ? {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: { $dateTrunc: { date: '$updated_at', unit: 'week', binSize: 1, timezone: 'UTC' } },
                  timezone: 'UTC',
                },
              }
            : {
                $dateToString: { format: '%Y-%m-%d', date: { $dateTrunc: { date: '$updated_at', unit: 'day', timezone: 'UTC' } }, timezone: 'UTC' },
              },
        },
      },
      { $group: { _id: '$bucket', count: { $sum: 1 } } },
    ];

    // Execute both aggregations in parallel
    const [createdAgg, updatedAgg] = await Promise.all([
      usersCol.aggregate(createdPipeline, { allowDiskUse: true }).toArray(),
      usersCol.aggregate(updatedPipeline, { allowDiskUse: true }).toArray(),
    ]);

    // Merge results into seriesMap
    for (const row of createdAgg) {
      const b = row?._id;
      if (b && seriesMap[b]) {
        seriesMap[b].createdCount += Number(row.count || 0);
      }
    }
    for (const row of updatedAgg) {
      const b = row?._id;
      if (b && seriesMap[b]) {
        seriesMap[b].updatedCount += Number(row.count || 0);
      }
    }

    // Build response series in requested order, ensuring zero-filled buckets are present
    const series = buckets.map((b) => ({
      bucket: b,
      createdCount: seriesMap[b]?.createdCount || 0,
      updatedCount: seriesMap[b]?.updatedCount || 0,
    }));

    return res.status(200).json({
      success: true,
      granularity,
      from: from.toISOString(),
      to: to.toISOString(),
      series,
    });
  } catch (err) {
    next(err);
  }
}

// PUBLIC_INTERFACE
async function getCostsTrend(req, res, next) {
  /**
   * Returns Costs Trend time series from costs_by_date array inside llm_costs documents.
   * Query:
   * - from, to (ISO)
   * - granularity: day|week|month
   */
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'Database not connected' });

    const now = new Date();
    const from = toDate(req.query.from) || startOfDay(addDays(now, -30));
    const to = toDate(req.query.to) || now;
    if (!(from instanceof Date) || !(to instanceof Date) || +from >= +to) {
      return res.status(400).json({ error: 'Invalid from/to' });
    }
    const granularity = normalizeGranularity(String(req.query.granularity || 'day'));

    const buckets = buildBuckets(from, to, granularity);
    const series = Object.fromEntries(buckets.map((b) => [b, 0]));

    const baseMatch = {};
    if (req.tenantScope && req.tenantScope.tenant_id) {
      baseMatch.tenant_id = req.tenantScope.tenant_id;
    }

    // Unwind costs_by_date and filter by date range (stored as YYYY-MM-DD)
    const pipeline = [
      { $match: baseMatch },
      { $unwind: '$costs_by_date' },
      {
        $match: {
          'costs_by_date.date': {
            $gte: toISODate(startOfDay(from)),
            $lte: toISODate(startOfDay(to)),
          },
        },
      },
      {
        $project: {
          date: '$costs_by_date.date', // YYYY-MM-DD
          cost: {
            $cond: [
              { $isNumber: '$costs_by_date.cost' },
              '$costs_by_date.cost',
              {
                $convert: { input: '$costs_by_date.cost', to: 'double', onError: 0, onNull: 0 },
              },
            ],
          },
        },
      },
    ];

    const cursor = db.collection('llm_costs').aggregate(pipeline, { allowDiskUse: true });
    for await (const row of cursor) {
      const key = bucketKey(row.date, granularity);
      if (key && series[key] !== undefined) {
        series[key] += Number(row.cost || 0);
      }
    }

    return res.json({
      items: buckets.map((b) => ({ date: b, total: Number(series[b] || 0) })),
      meta: { granularity, from: from.toISOString(), to: to.toISOString() },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSessionsTrend,
  getUsersTrend,
  getCostsTrend,
};
