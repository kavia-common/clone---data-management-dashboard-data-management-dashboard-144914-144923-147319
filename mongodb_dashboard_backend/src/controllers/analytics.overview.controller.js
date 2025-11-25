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

// PUBLIC_INTERFACE
async function getUsersTrend(req, res, next) {
  /**
   * Returns Users Trend time series.
   * Query:
   * - from, to (ISO)
   * - granularity: day|week|month
   * - status: active|deleted (default active)
   * Rules:
   * - Use users.created_at and users.updated_at.
   *   active: not deleted and created/updated within range.
   *   deleted: deleted_at within range OR status === 'deleted' with updated_at in range.
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
    const status = String(req.query.status || 'active').toLowerCase();

    const buckets = buildBuckets(from, to, granularity);
    const series = Object.fromEntries(buckets.map((b) => [b, 0]));

    const baseMatch = {};
    if (req.tenantScope && req.tenantScope.tenant_id) {
      baseMatch.tenant_id = req.tenantScope.tenant_id;
    }

    let match = { ...baseMatch };
    if (status === 'deleted') {
      match.$or = [
        { deleted_at: { $gte: from, $lt: to } },
        { $and: [{ status: 'deleted' }, { updated_at: { $gte: from, $lt: to } }] },
      ];
    } else {
      match.$and = [
        {
          $or: [
            { created_at: { $gte: from, $lt: to } },
            { updated_at: { $gte: from, $lt: to } },
          ],
        },
        {
          $or: [{ deleted_at: { $exists: false } }, { deleted_at: null }, { status: { $ne: 'deleted' } }],
        },
      ];
    }

    const cursor = db.collection('users').find(match, {
      projection: { created_at: 1, updated_at: 1, deleted_at: 1, status: 1 },
    });

    for await (const u of cursor) {
      let d = null;
      if (status === 'deleted') {
        d = u.deleted_at || u.updated_at || u.created_at;
      } else {
        d = u.created_at || u.updated_at || null;
      }
      if (!d) continue;
      const key = bucketKey(d, granularity);
      if (key && series[key] !== undefined) series[key] += 1;
    }

    return res.json({
      items: buckets.map((b) => ({
        // For month granularity 'b' is already YYYY-MM, else YYYY-MM-DD
        date: b,
        total: series[b] || 0,
      })),
      meta: { granularity, from: from.toISOString(), to: to.toISOString(), status },
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
