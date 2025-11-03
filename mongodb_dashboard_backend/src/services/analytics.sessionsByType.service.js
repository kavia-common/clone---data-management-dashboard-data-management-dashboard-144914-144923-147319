'use strict';

/**
 * PUBLIC_INTERFACE
 * getSessionsByTypeTimeSeries
 * This service aggregates the session_tracking collection to produce a time series of counts grouped by type.
 * - Accepts date range (from, to) with default last 30 days.
 * - Accepts granularity (day|week|month), default day.
 * - Accepts tenant_id filter.
 * - Derives the "type" from service_type or type fields (first non-empty).
 * - Uses last_updated if present else session_start as event timestamp.
 * Returns:
 *   {
 *     items: [
 *       { date: 'YYYY-MM-DD', series: { "<typeA>": 3, "<typeB>": 0, ... }, total: 3 },
 *       ...
 *     ],
 *     meta: { from, to, granularity, types: ["typeA","typeB",...], bucketCount }
 *   }
 */

const { DateTime } = require('luxon');
const db = require('../config/db');
const { buildDateRange } = require('../utils/dateRange');
const logger = console; // lightweight logging without external dependency

/**
 * Compute ISO start of bucket key from date and granularity.
 * @param {Date} date 
 * @param {"day"|"week"|"month"} granularity 
 * @returns {string} YYYY-MM-DD for the bucket start
 */
function bucketKey(date, granularity) {
  const dt = DateTime.fromJSDate(date).toUTC();
  if (granularity === 'week') return dt.startOf('week').toFormat('yyyy-LL-dd');
  if (granularity === 'month') return dt.startOf('month').toFormat('yyyy-LL-dd');
  return dt.startOf('day').toFormat('yyyy-LL-dd');
}

// PUBLIC_INTERFACE
async function getSessionsByTypeTimeSeries({
  from,
  to,
  granularity = 'day',
  tenant_id,
}) {
  // normalize and defaults: last 30 days ending now
  const now = DateTime.utc();
  const defaultFrom = now.minus({ days: 30 });
  const startISO = from ? DateTime.fromISO(from, { zone: 'utc' }) : defaultFrom;
  const endISO = to ? DateTime.fromISO(to, { zone: 'utc' }) : now;

  // guard invalid dates
  if (!startISO.isValid || !endISO.isValid) {
    throw new Error('Invalid date range');
  }
  const start = startISO.toJSDate();
  const end = endISO.toJSDate();

  const collection = db.get().collection('session_tracking');
  if (!collection) {
    throw new Error('Database not connected or collection missing');
  }

  // Build match stage: use last_updated if present else session_start
  // Filter by tenant_id if provided
  const timeField = {
    $ifNull: ['$last_updated', '$session_start'],
  };

  const $match = {
    $expr: {
      $and: [
        { $gte: [timeField, start] },
        { $lte: [timeField, end] },
      ],
    },
  };

  if (tenant_id) {
    $match.tenant_id = tenant_id;
  }

  // Compute "type" coalescing service_type -> type -> session_data.serviceType
  const typeExpr = {
    $ifNull: [
      '$service_type',
      {
        $ifNull: ['$type', '$session_data.serviceType'],
      },
    ],
  };

  // Project bucket and type
  const $project = {
    _ts: timeField,
    _type: typeExpr,
  };

  // Group into buckets; compute a day key first, then adjust in JS after aggregation if needed
  // We'll build day granularity on DB and post-adjust for week/month by combining.
  const $group = {
    _id: {
      day: {
        $dateToString: { date: '$_ts', format: '%Y-%m-%d', timezone: 'UTC' },
      },
      type: '$_type',
    },
    count: { $sum: 1 },
  };

  const $group2 = {
    _id: '$_id.day',
    series: {
      $push: {
        k: { $ifNull: ['$_id.type', 'unknown'] },
        v: '$count',
      },
    },
    total: { $sum: '$count' },
  };

  const pipeline = [
    { $match },
    { $project },
    { $group },
    { $group: $group2 },
    { $sort: { _id: 1 } },
  ];

  logger.debug?.('[sessions-by-type] pipeline', JSON.stringify(pipeline));

  const raw = await collection.aggregate(pipeline).toArray();

  // Turn to map by day: { date, series: {type: count}, total }
  const byDayMap = new Map();
  const allTypesSet = new Set();
  for (const row of raw) {
    const date = row._id;
    const seriesObj = {};
    for (const kv of row.series) {
      const k = kv.k || 'unknown';
      const v = kv.v || 0;
      seriesObj[k] = v;
      allTypesSet.add(k);
    }
    byDayMap.set(date, { date, series: seriesObj, total: row.total || 0 });
  }

  // Construct full timeline with zero fill per day, then combine to granularity
  const cursor = DateTime.fromJSDate(start).startOf('day');
  const endDay = DateTime.fromJSDate(end).startOf('day');
  const allTypes = Array.from(allTypesSet).sort();

  const dailyItems = [];
  for (let dt = cursor; dt <= endDay; dt = dt.plus({ days: 1 })) {
    const dateKey = dt.toFormat('yyyy-LL-dd');
    const found = byDayMap.get(dateKey);
    if (found) {
      // ensure all types present with zeros
      for (const t of allTypes) {
        if (found.series[t] == null) found.series[t] = 0;
      }
      dailyItems.push({
        date: dateKey,
        series: found.series,
        total: found.total,
      });
    } else {
      // zero day
      const emptySeries = {};
      for (const t of allTypes) emptySeries[t] = 0;
      dailyItems.push({ date: dateKey, series: emptySeries, total: 0 });
    }
  }

  // If no data at all (no types), provide empty series placeholder to allow UI to render axes
  if (allTypes.length === 0) {
    const emptyItems = [];
    for (let dt = cursor; dt <= endDay; dt = dt.plus({ days: 1 })) {
      emptyItems.push({ date: dt.toFormat('yyyy-LL-dd'), series: {}, total: 0 });
    }
    return {
      items: emptyItems,
      meta: {
        from: startISO.toISO(),
        to: endISO.toISO(),
        granularity,
        types: [],
        bucketCount: emptyItems.length,
      },
    };
  }

  // Rebucket for week/month if needed
  if (granularity === 'day') {
    return {
      items: dailyItems,
      meta: {
        from: startISO.toISO(),
        to: endISO.toISO(),
        granularity,
        types: allTypes,
        bucketCount: dailyItems.length,
      },
    };
  }

  // For week/month combine daily buckets
  const grouped = new Map();
  for (const item of dailyItems) {
    const bucketDate = bucketKey(DateTime.fromISO(item.date, { zone: 'utc' }).toJSDate(), granularity);
    let target = grouped.get(bucketDate);
    if (!target) {
      const initSeries = {};
      for (const t of allTypes) initSeries[t] = 0;
      target = { date: bucketDate, series: initSeries, total: 0 };
      grouped.set(bucketDate, target);
    }
    // sum series
    for (const t of allTypes) {
      target.series[t] += item.series[t] || 0;
    }
    target.total += item.total || 0;
  }

  const items = Array.from(grouped.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  return {
    items,
    meta: {
      from: startISO.toISO(),
      to: endISO.toISO(),
      granularity,
      types: allTypes,
      bucketCount: items.length,
    },
  };
}

module.exports = {
  getSessionsByTypeTimeSeries,
};
