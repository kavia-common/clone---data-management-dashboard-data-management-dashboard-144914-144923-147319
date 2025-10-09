'use strict';

const User = require('../models/user.model');

/**
 * PUBLIC_INTERFACE
 * getNewUsersOverTime
 * Aggregates users created over time between start and end with the specified granularity.
 * - granularity: 'day' | 'week' | 'month' (default 'day')
 * - start, end: Date objects (inclusive start, inclusive end for bucketing)
 * Returns:
 *  {
 *    granularity: 'day'|'week'|'month',
 *    start: <iso>,
 *    end: <iso>,
 *    points: [ { bucket: <string>, count: <number> }, ... ]
 *  }
 */
async function getNewUsersOverTime({ granularity = 'day', start, end }) {
  // Normalize granularity
  const g = ['day', 'week', 'month'].includes((granularity || '').toLowerCase())
    ? (granularity || '').toLowerCase()
    : 'day';

  // Guard dates
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw Object.assign(new Error('Invalid start date'), { status: 400 });
  }
  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    throw Object.assign(new Error('Invalid end date'), { status: 400 });
  }
  if (end < start) {
    throw Object.assign(new Error('"end" must be after "start"'), { status: 400 });
  }

  // Mongo aggregation using $match on created_at
  const match = {
    created_at: { $gte: start, $lte: end },
  };

  // Build bucket expression depending on granularity and Mongo capability.
  // For portability, we will use $dateTrunc when available, and fallback to $dateToString formatting.
  // Because feature detection isn't trivial server-side, we'll primarily use $dateToString formats
  // and provide reasonable week bucketing via ISO week start (Monday).
  const timezone = 'UTC';

  let projectStage;
  let groupIdExpr;
  let bucketFormat = '%Y-%m-%d'; // default day

  if (g === 'day') {
    bucketFormat = '%Y-%m-%d';
    projectStage = {
      $project: {
        bucket: { $dateToString: { format: bucketFormat, date: '$created_at', timezone } },
      },
    };
    groupIdExpr = '$bucket';
  } else if (g === 'week') {
    // For week, derive an ISO week-string format (year-week), and also compute weekStart date string
    projectStage = {
      $project: {
        bucket: {
          $concat: [
            { $toString: { $isoWeekYear: '$created_at' } },
            '-W',
            {
              $let: {
                vars: { wk: { $isoWeek: '$created_at' } },
                in: {
                  $cond: [
                    { $gte: ['$$wk', 10] },
                    { $toString: '$$wk' },
                    { $concat: ['0', { $toString: '$$wk' }] },
                  ],
                },
              },
            },
          ],
        },
      },
    };
    groupIdExpr = '$bucket';
  } else {
    // month
    bucketFormat = '%Y-%m';
    projectStage = {
      $project: {
        bucket: { $dateToString: { format: bucketFormat, date: '$created_at', timezone } },
      },
    };
    groupIdExpr = '$bucket';
  }

  const pipeline = [
    { $match: match },
    projectStage,
    {
      $group: {
        _id: groupIdExpr,
        count: { $sum: 1 },
      },
    },
    { $project: { _id: 0, bucket: '$_id', count: 1 } },
    { $sort: { bucket: 1 } },
  ];

  const rows = await User.aggregate(pipeline).allowDiskUse(true);

  // Fill missing buckets on server
  const filled = fillMissingBuckets({
    granularity: g,
    start,
    end,
    rows,
  });

  return {
    granularity: g,
    start: start.toISOString(),
    end: end.toISOString(),
    points: filled,
  };
}

/**
 * Create continuous buckets between start and end with the specified granularity and
 * merge with existing rows (which contain { bucket, count }).
 */
function fillMissingBuckets({ granularity, start, end, rows }) {
  const map = new Map((rows || []).map((r) => [String(r.bucket), Number(r.count) || 0]));

  const points = [];
  const cursor = new Date(start.getTime());

  if (granularity === 'day') {
    // normalize to 00:00 UTC
    setToStartOfDayUTC(cursor);
    const endDay = new Date(end.getTime());
    setToStartOfDayUTC(endDay);

    while (cursor <= endDay) {
      const key = formatDay(cursor);
      points.push({ bucket: key, count: map.get(key) || 0 });
      // add 1 day
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else if (granularity === 'week') {
    // align to ISO week start (Monday)
    const weekStart = startOfISOWeekUTC(cursor);
    const endWeek = startOfISOWeekUTC(new Date(end.getTime()));
    while (weekStart <= endWeek) {
      const key = formatISOWeek(weekStart);
      points.push({ bucket: key, count: map.get(key) || 0 });
      // next week
      weekStart.setUTCDate(weekStart.getUTCDate() + 7);
    }
  } else {
    // month
    const monthStart = startOfMonthUTC(cursor);
    const endMonth = startOfMonthUTC(new Date(end.getTime()));
    while (monthStart <= endMonth) {
      const key = formatMonth(monthStart);
      points.push({ bucket: key, count: map.get(key) || 0 });
      // next month
      monthStart.setUTCMonth(monthStart.getUTCMonth() + 1);
    }
  }

  return points;
}

// Helpers: date formatting and boundaries (UTC)
function setToStartOfDayUTC(d) {
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
function startOfMonthUTC(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  return x;
}
function startOfISOWeekUTC(d) {
  // Clone and get current day (Mon=1 ... Sun=7)
  const x = new Date(d.getTime());
  x.setUTCHours(0, 0, 0, 0);
  let day = x.getUTCDay(); // Sun=0, Mon=1, ... Sat=6
  if (day === 0) day = 7; // make Sunday 7
  // move back to Monday
  x.setUTCDate(x.getUTCDate() - (day - 1));
  return x;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}
function weekNumberISO(d) {
  // Compute ISO week number and ISO week year for formatting; using algorithm with UTC
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year.
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  const isoYear = tmp.getUTCFullYear();
  return { weekNo, isoYear };
}
function formatISOWeek(weekStartDate) {
  const { weekNo, isoYear } = weekNumberISO(weekStartDate);
  return `${isoYear}-W${pad2(weekNo)}`;
}
function formatDay(d) {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${y}-${m}-${day}`;
}
function formatMonth(d) {
  const y = d.getUTCFullYear();
  const m = pad2(d.getUTCMonth() + 1);
  return `${y}-${m}`;
}

module.exports = {
  getNewUsersOverTime,
};
