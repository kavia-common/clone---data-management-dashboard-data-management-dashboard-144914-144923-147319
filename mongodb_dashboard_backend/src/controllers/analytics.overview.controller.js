'use strict';

const { getDb, isDbConnected } = require('../config/db');
const { startOfDayUTC, addDaysUTC, formatYYYYMMDD } = require('../utils/date');

/**
 * PUBLIC_INTERFACE
 * computeOverviewAnalytics
 * Controller for GET /api/analytics/overview
 *
 * Query params:
 * - range: 7d | 30d | 12w | 12m
 * - bucket: daily | weekly | monthly
 *
 * Response:
 *  {
 *    kpis: { total, created, updated, deleted },
 *    series: [{ t, value }],
 *    meta: { bucket, range }
 *  }
 *
 * Notes:
 * - Aggregates over a generic "events" style data model when available:
 *   tries to infer collections and fields:
 *     - Primary collections attempted: ['audit_log', 'auditLog', 'audit_logs', 'events', 'records', 'session_tracking']
 *     - Timestamps considered: ['created_at','createdAt','timestamp','last_updated','updated_at','updatedAt','session_start']
 *     - Operation hints: ['operation','action','event_type','type','status'] with values including created/updated/deleted when present.
 * - If DB is not connected or collections are absent, responds with a zero-filled time series for the requested range/bucket.
 */

// PUBLIC_INTERFACE
async function computeOverviewAnalytics(req, res) {
  try {
    const { range = '30d', bucket = 'daily' } = req.query;

    // Validate/normalize inputs
    const validRanges = new Set(['7d', '30d', '12w', '12m']);
    const validBuckets = new Set(['daily', 'weekly', 'monthly']);
    const normRange = validRanges.has(range) ? range : '30d';
    const normBucket = validBuckets.has(bucket) ? bucket : 'daily';

    // Resolve start-end based on range
    const now = new Date();
    let start = new Date(now);
    let stepDays = 1;

    if (normRange === '7d') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (normRange === '30d') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (normRange === '12w') {
      start = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
    } else if (normRange === '12m') {
      // Approximate 12 months as 365 days
      start = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    }

    if (normBucket === 'daily') stepDays = 1;
    else if (normBucket === 'weekly') stepDays = 7;
    else if (normBucket === 'monthly') stepDays = 30; // approximate monthly bucket

    const periodStart = startOfDayUTC(start);
    const periodEnd = startOfDayUTC(now);

    // Helper to produce empty series for resilience
    const buildEmptySeries = () => {
      const points = [];
      let cursor = new Date(periodStart);
      // Generate until we pass end (inclusive of last bucket start)
      while (cursor <= periodEnd) {
        points.push({ t: formatYYYYMMDD(cursor), value: 0 });
        cursor = addDaysUTC(cursor, stepDays);
      }
      return points;
    };

    // If DB not connected, return empty series to keep UI functional
    if (!isDbConnected()) {
      return res.status(200).json({
        kpis: { total: 0, created: 0, updated: 0, deleted: 0 },
        series: buildEmptySeries(),
        meta: { bucket: normBucket, range: normRange },
      });
    }

    // Try to aggregate from plausible collections
    const db = await getDb();

    // Decide on candidate collection and fields
    const candidateCollections = [
      'audit_log',
      'auditLog',
      'audit_logs',
      'events',
      'records',
      'session_tracking',
    ];
    const existing = await db.listCollections({}, { nameOnly: true }).toArray();
    const existingNames = new Set(existing.map((c) => c.name));
    const collectionName =
      candidateCollections.find((n) => existingNames.has(n)) || null;

    if (!collectionName) {
      // Fallback - no known collection exists
      return res.status(200).json({
        kpis: { total: 0, created: 0, updated: 0, deleted: 0 },
        series: buildEmptySeries(),
        meta: { bucket: normBucket, range: normRange },
      });
    }

    const col = db.collection(collectionName);

    // Try to detect timestamp and operation fields
    const timestampFields = [
      'created_at',
      'createdAt',
      'timestamp',
      'last_updated',
      'updated_at',
      'updatedAt',
      'session_start',
    ];
    const opFields = ['operation', 'action', 'event_type', 'type', 'status'];

    // Probe first document for field hints (best-effort)
    const sample = await col.find({}).project({}).limit(1).toArray();
    const sampleDoc = sample[0] || {};
    const chosenTsField =
      timestampFields.find((f) => Object.prototype.hasOwnProperty.call(sampleDoc, f)) ||
      'created_at';
    const chosenOpField =
      opFields.find((f) => Object.prototype.hasOwnProperty.call(sampleDoc, f)) ||
      null;

    // Build $match for date range
    const match = {
      [chosenTsField]: {
        $gte: periodStart,
        $lte: new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000 - 1), // include end day
      },
    };

    // Build group id by bucket
    let dateToParts = {
      year: { $year: { date: `$${chosenTsField}`, timezone: 'UTC' } },
      month: { $month: { date: `$${chosenTsField}`, timezone: 'UTC' } },
      day: { $dayOfMonth: { date: `$${chosenTsField}`, timezone: 'UTC' } },
    };

    if (normBucket === 'weekly') {
      // Use ISO week (approximation without $isoWeekYear/$isoWeek in older servers)
      dateToParts = {
        year: { $year: { date: `$${chosenTsField}`, timezone: 'UTC' } },
        week: { $week: { date: `$${chosenTsField}`, timezone: 'UTC' } },
      };
    } else if (normBucket === 'monthly') {
      dateToParts = {
        year: { $year: { date: `$${chosenTsField}`, timezone: 'UTC' } },
        month: { $month: { date: `$${chosenTsField}`, timezone: 'UTC' } },
      };
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: dateToParts,
          count: { $sum: 1 },
          ...(chosenOpField
            ? {
                created: {
                  $sum: {
                    $cond: [
                      { $in: [{ $toLower: { $ifNull: [`$${chosenOpField}`, ''] } }, ['create', 'created', 'insert', 'inserted']] },
                      1,
                      0,
                    ],
                  },
                },
                updated: {
                  $sum: {
                    $cond: [
                      { $in: [{ $toLower: { $ifNull: [`$${chosenOpField}`, ''] } }, ['update', 'updated', 'modify', 'modified']] },
                      1,
                      0,
                    ],
                  },
                },
                deleted: {
                  $sum: {
                    $cond: [
                      { $in: [{ $toLower: { $ifNull: [`$${chosenOpField}`, ''] } }, ['delete', 'deleted', 'remove', 'removed']] },
                      1,
                      0,
                    ],
                  },
                },
              }
            : {}),
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.week': 1, '_id.day': 1 } },
    ];

    const raw = await col.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Build map for quick lookups
    const byKey = new Map();
    let kpiCreated = 0;
    let kpiUpdated = 0;
    let kpiDeleted = 0;
    let kpiTotal = 0;

    for (const r of raw) {
      let keyDateStr = '';
      if (normBucket === 'daily') {
        const y = r._id.year;
        const m = r._id.month;
        const d = r._id.day;
        keyDateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      } else if (normBucket === 'weekly') {
        const y = r._id.year;
        const w = r._id.week;
        // Represent as first day of that week (approx): year-week -> convert to a pseudo-date string
        keyDateStr = `${String(y).padStart(4, '0')}-W${String(w).padStart(2, '0')}`;
      } else {
        // monthly
        const y = r._id.year;
        const m = r._id.month;
        keyDateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
      }

      const value = r.count || 0;
      byKey.set(keyDateStr, value);

      kpiTotal += value;
      if (typeof r.created === 'number') kpiCreated += r.created;
      if (typeof r.updated === 'number') kpiUpdated += r.updated;
      if (typeof r.deleted === 'number') kpiDeleted += r.deleted;
    }

    // Generate full series with zeros for missing points
    const series = [];
    let cursor = new Date(periodStart);
    while (cursor <= periodEnd) {
      if (normBucket === 'daily') {
        const t = formatYYYYMMDD(cursor);
        series.push({ t, value: byKey.get(t) || 0 });
        cursor = addDaysUTC(cursor, stepDays);
      } else if (normBucket === 'weekly') {
        // For weekly, format t as YYYY-Www using ISO-like pattern
        const y = cursor.getUTCFullYear();
        // approximate: week number by using /7 from day of year
        const startOfYear = new Date(Date.UTC(y, 0, 1));
        const diffDays = Math.floor((cursor - startOfYear) / (24 * 60 * 60 * 1000)) + 1;
        const w = Math.max(1, Math.min(53, Math.ceil(diffDays / 7)));
        const key = `${String(y).padStart(4, '0')}-W${String(w).padStart(2, '0')}`;
        series.push({ t: key, value: byKey.get(key) || 0 });
        cursor = addDaysUTC(cursor, stepDays);
      } else {
        // monthly key YYYY-MM
        const y = cursor.getUTCFullYear();
        const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
        const key = `${String(y).padStart(4, '0')}-${m}`;
        series.push({ t: key, value: byKey.get(key) || 0 });
        cursor = addDaysUTC(cursor, stepDays);
      }
    }

    return res.status(200).json({
      kpis: {
        total: kpiTotal,
        created: kpiCreated,
        updated: kpiUpdated,
        deleted: kpiDeleted,
      },
      series,
      meta: { bucket: normBucket, range: normRange },
    });
  } catch (err) {
    // On any failure, provide safe empty series to avoid UI "Failed to fetch"
    // eslint-disable-next-line no-console
    console.error('[analytics.overview] error:', err?.message || err);
    // Default to daily/30d fallbacks if query parsing failed earlier
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const series = [];
    let cursor = startOfDayUTC(start);
    const end = startOfDayUTC(now);
    while (cursor <= end) {
      series.push({ t: formatYYYYMMDD(cursor), value: 0 });
      cursor = addDaysUTC(cursor, 1);
    }
    return res.status(200).json({
      kpis: { total: 0, created: 0, updated: 0, deleted: 0 },
      series,
      meta: { bucket: 'daily', range: '30d' },
    });
  }
}

module.exports = {
  computeOverviewAnalytics,
};
