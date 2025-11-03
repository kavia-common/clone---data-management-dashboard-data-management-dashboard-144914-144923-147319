'use strict';

/**
 * Feature Usage Analytics Controller
 * Aggregates session tracking data to compute feature usage over time for a given service type.
 * 
 * PUBLIC_INTERFACE
 * async function getFeatureUsage(req, res)
 *   Summary: Return time-series counts of session documents grouped by feature for a serviceType,
 *            including most-used and least-used features within the period.
 *   Query Parameters:
 *     - serviceType (string, optional): Service type to filter sessions (e.g., "chat", "etl"). If omitted, aggregates across all.
 *     - from (ISO datetime, optional): Start of range (inclusive). Default: 30 days ago.
 *     - to (ISO datetime, optional): End of range (exclusive upper bound for bucketing). Default: now.
 *     - interval (string, optional): "day" | "week". Default: "day".
 *   Returns:
 *     200 JSON:
 *       {
 *         serviceType: string | null,
 *         range: { from: string, to: string },
 *         interval: "day" | "week",
 *         features: [
 *           { name: string, totalCount: number, series: [ { t: string, count: number } ] }
 *         ],
 *         mostUsed: string | null,
 *         leastUsed: string | null
 *       }
 */
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
dayjs.extend(utc);

const { getDb } = require('../config/db');

const INTERVALS = new Set(['day', 'week']);

/**
 * Normalize and validate inputs, and return computed range and interval.
 */
function parseQuery(req) {
  const serviceType = req.query.serviceType ? String(req.query.serviceType).trim() : null;

  const intervalRaw = (req.query.interval || 'day').toString().toLowerCase();
  const interval = INTERVALS.has(intervalRaw) ? intervalRaw : 'day';

  const now = dayjs().utc();
  const defaultFrom = now.subtract(30, 'day'); // last 30 days default
  const from = req.query.from ? dayjs(req.query.from).utc() : defaultFrom;
  const to = req.query.to ? dayjs(req.query.to).utc() : now;

  if (!from.isValid() || !to.isValid() || !to.isAfter(from)) {
    const err = new Error('Invalid date range. Ensure `from` and `to` are valid ISO dates and `to` > `from`.');
    err.statusCode = 400;
    throw err;
  }

  return { serviceType, interval, from, to };
}

/**
 * Build a MongoDB $dateTrunc expression based on interval.
 */
function dateTruncExpr(field, interval) {
  return {
    $dateTrunc: {
      date: field,
      unit: interval, // 'day' | 'week'
      timezone: 'UTC'
    }
  };
}

/**
 * Fill missing buckets with count=0 for a feature based on the computed timeline.
 */
function fillMissingBuckets(seriesMap, allBuckets) {
  const result = [];
  for (const tIso of allBuckets) {
    result.push({ t: tIso, count: seriesMap.get(tIso) || 0 });
  }
  return result;
}

/**
 * Generate all bucket boundaries between from and to using given interval.
 */
function generateBuckets(from, to, interval) {
  const buckets = [];
  let cursor = from.startOf(interval);
  const end = to.startOf(interval);
  // Include the end bucket if from and to fall in same bucket edge-cases
  while (cursor.isBefore(end) || cursor.isSame(end)) {
    buckets.push(cursor.toDate());
    cursor = cursor.add(1, interval);
    // Prevent runaway loops
    if (buckets.length > 366 * 3) break; // cap ~3 years of daily buckets
  }
  return buckets.map(d => dayjs(d).utc().toISOString());
}

// PUBLIC_INTERFACE
async function getFeatureUsage(req, res) {
  /**
   * Returns time-series counts of sessions grouped by feature for a given serviceType.
   * The response includes both the complete series for all features in the period,
   * and identifies the mostUsed and leastUsed feature names by totalCount.
   */
  try {
    const { serviceType, interval, from, to } = parseQuery(req);
    const db = getDb();
    if (!db) {
      return res.status(503).json({ error: 'Database not connected' });
    }

    // Session collection and fields
    // Infer time field: prefer last_updated, fallback session_start
    const sessions = db.collection('session_tracking');

    const match = {
      $and: [
        {
          $or: [
            { last_updated: { $gte: from.toDate(), $lt: to.toDate() } },
            {
              $and: [
                { last_updated: { $exists: false } },
                { session_start: { $gte: from.toDate(), $lt: to.toDate() } }
              ]
            }
          ]
        }
      ]
    };
    if (serviceType) {
      match.$and.push({ service_type: serviceType });
    }

    // Project a unified timestamp and a feature name.
    // Assuming features may live in: session_data.feature or feature_name or action
    const timeField = {
      $cond: [
        { $ifNull: ['$last_updated', false] },
        '$last_updated',
        '$session_start'
      ]
    };

    // Choose feature name precedence
    const featureExpr = {
      $ifNull: [
        '$session_data.feature',
        {
          $ifNull: ['$feature_name', { $ifNull: ['$action', 'unknown'] }]
        }
      ]
    };

    const pipeline = [
      { $match: match },
      {
        $project: {
          _id: 0,
          feature: featureExpr,
          t: timeField
        }
      },
      {
        $addFields: {
          bucket: dateTruncExpr('$t', interval)
        }
      },
      // Only consider docs where feature is a non-empty string
      {
        $match: {
          feature: { $type: 'string', $ne: '' }
        }
      },
      {
        $group: {
          _id: { feature: '$feature', bucket: '$bucket' },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.feature',
          series: {
            $push: {
              t: '$_id.bucket',
              count: '$count'
            }
          },
          totalCount: { $sum: '$count' }
        }
      },
      {
        $project: {
          _id: 0,
          name: '$_id',
          totalCount: 1,
          series: 1
        }
      },
      {
        $sort: { totalCount: -1, name: 1 }
      }
    ];

    const rows = await sessions.aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Debug logs for visibility when empty
    if (!rows || rows.length === 0) {
      // Keep logs minimal to avoid leaking data; include params and pipeline tips
      console.info('[feature-usage] No rows from aggregation', {
        serviceType: serviceType || null,
        interval,
        from: from.toISOString(),
        to: to.toISOString(),
        collection: 'session_tracking',
        featureFieldsTried: ['session_data.feature', 'feature_name', 'action'],
        timeFieldsTried: ['last_updated', 'session_start']
      });
    }

    // Generate complete timeline buckets and fill missing dates for each feature
    const allBucketsIso = generateBuckets(from, to, interval);

    const features = rows.map(row => {
      const seriesMap = new Map(
        row.series.map(p => [dayjs(p.t).utc().toISOString(), p.count])
      );
      return {
        name: row.name,
        totalCount: row.totalCount,
        series: fillMissingBuckets(seriesMap, allBucketsIso)
      };
    });

    // Determine most and least used features (by totalCount)
    let mostUsed = null;
    let leastUsed = null;
    if (features.length > 0) {
      // rows was sorted desc already; features preserves that order
      mostUsed = features[0]?.name ?? null;

      // For least, find the min by totalCount; sort ascending by totalCount then name
      const least = [...features].sort((a, b) => {
        if (a.totalCount !== b.totalCount) return a.totalCount - b.totalCount;
        return a.name.localeCompare(b.name);
      })[0];
      leastUsed = least ? least.name : null;
    }

    return res.json({
      serviceType: serviceType,
      range: { from: from.toISOString(), to: to.toISOString() },
      interval,
      features,
      mostUsed,
      leastUsed
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
}

module.exports = {
  getFeatureUsage
};
