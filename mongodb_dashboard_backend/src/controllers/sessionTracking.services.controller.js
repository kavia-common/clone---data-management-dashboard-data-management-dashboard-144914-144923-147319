"use strict";

/**
 * PUBLIC_INTERFACE
 * Handler for GET /api/session-tracking/services
 * Aggregates session_tracking.service_type usage counts for a tenant within a date range.
 * Supports:
 *  - interval: daily|weekly|monthly|custom (default daily)
 *  - start_date, end_date: ISO date or YYYY-MM-DD (UTC normalized). Defaults to last 30 days.
 *  - top: optional integer limit [1,50] to restrict categories returned (sorted by count desc).
 *  - status: optional regex string for filtering status field.
 *  - include_unknown: boolean; when false (default) filters out null/"" service_type
 *  - withTimeBuckets: when true and interval is daily/weekly/monthly, returns per-time-bucket breakdowns.
 *
 * Responses:
 *  Overall (with categories only):
 *    { success: true, data: [{ label, count }], meta: { interval, start, end, total, most: {label,count} | null, least: {label,count} | null } }
 *  With time buckets:
 *    { success: true, data: [{ bucketStart: ISOString, items: [{ label, count }] }], meta: { interval, start, end } }
 */

const { Types } = require("mongoose");
const SessionTracking = require("../models/sessionTracking.model");
const { DateTime } = require("luxon");

// Helpers

/**
 * Normalize boolean-like query param.
 */
function toBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === "boolean") return val;
  const s = String(val).toLowerCase().trim();
  return ["1", "true", "yes", "y", "on"].includes(s);
}

/**
 * Parse date from query (ISO or YYYY-MM-DD) and normalize to start/end of day as needed.
 */
function parseDate(value, opts = { startOfDay: false, endOfDay: false }) {
  if (!value) return null;
  let dt = DateTime.fromISO(value, { zone: "utc" });
  if (!dt.isValid) {
    dt = DateTime.fromFormat(value, "yyyy-MM-dd", { zone: "utc" });
  }
  if (!dt.isValid) return null;
  if (opts.startOfDay) dt = dt.startOf("day");
  if (opts.endOfDay) dt = dt.endOf("day");
  return dt.toJSDate();
}

/**
 * Determine default window (last 30 days UTC).
 */
function defaultWindow() {
  const end = DateTime.utc().endOf("day");
  const start = end.minus({ days: 30 }).startOf("day");
  return { start: start.toJSDate(), end: end.toJSDate() };
}

/**
 * Build $match for base filtering by tenant and date range and optional status regex.
 */
function buildBaseMatch({ tenant_id, start, end, status }) {
  const match = {
    tenant_id: tenant_id,
    session_start: { $gte: start, $lte: end },
  };
  if (status && String(status).trim().length > 0) {
    try {
      match.status = { $regex: status, $options: "i" };
    } catch (e) {
      // If invalid regex, fallback to equality match to avoid 500
      match.status = String(status);
    }
  }
  return match;
}

/**
 * Build aggregation for overall service_type counts.
 */
function buildOverallPipeline({ match, includeUnknown, top }) {
  const pipeline = [
    { $match: match },
    { $project: { service_type: 1 } },
  ];

  if (!includeUnknown) {
    pipeline.push({
      $match: { service_type: { $ne: null, $ne: "" } },
    });
  }

  pipeline.push(
    { $group: { _id: "$service_type", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } }
  );

  if (typeof top === "number" && top >= 1 && top <= 50) {
    pipeline.push({ $limit: top });
  }

  pipeline.push({ $project: { _id: 0, label: "$_id", count: 1 } });
  return pipeline;
}

/**
 * Get Luxon unit for bucketing.
 */
function unitForInterval(interval) {
  switch (interval) {
    case "daily":
      return "day";
    case "weekly":
      return "week";
    case "monthly":
      return "month";
    default:
      return null;
  }
}

/**
 * Build pipeline for bucketed counts per service_type over time.
 * Returns items grouped by bucket and then by service_type.
 */
function buildBucketedPipeline({ match, includeUnknown, unit, start, end }) {
  // Compute date parts for grouping
  let dateParts;
  if (unit === "day") {
    dateParts = {
      y: { $year: "$session_start" },
      m: { $month: "$session_start" },
      d: { $dayOfMonth: "$session_start" },
    };
  } else if (unit === "week") {
    dateParts = {
      y: { $isoWeekYear: "$session_start" },
      w: { $isoWeek: "$session_start" },
    };
  } else if (unit === "month") {
    dateParts = {
      y: { $year: "$session_start" },
      m: { $month: "$session_start" },
    };
  } else {
    // fallback to day
    dateParts = {
      y: { $year: "$session_start" },
      m: { $month: "$session_start" },
      d: { $dayOfMonth: "$session_start" },
    };
  }

  const pipeline = [{ $match: match }];

  if (!includeUnknown) {
    pipeline.push({
      $match: { service_type: { $ne: null, $ne: "" } },
    });
  }

  pipeline.push(
    {
      $addFields: {
        bucket: dateParts,
      },
    },
    {
      $group: {
        _id: {
          bucket: "$bucket",
          service_type: "$service_type",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.bucket",
        items: {
          $push: {
            label: "$_id.service_type",
            count: "$count",
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        bucket: "$_id",
        items: 1,
      },
    },
    { $sort: { "bucket.y": 1, "bucket.m": 1, "bucket.d": 1, "bucket.w": 1 } }
  );

  return pipeline;
}

/**
 * Convert a grouped bucket object to ISO bucketStart.
 */
function bucketToISO(bucket, unit) {
  try {
    if (unit === "day") {
      const dt = DateTime.utc(bucket.y, bucket.m, bucket.d).startOf("day");
      return dt.toISO();
    } else if (unit === "week") {
      // ISO week/year to date: set to start of ISO week
      const dt = DateTime.fromObject(
        { weekYear: bucket.y, weekNumber: bucket.w, weekday: 1 },
        { zone: "utc" }
      ).startOf("day");
      return dt.toISO();
    } else if (unit === "month") {
      const dt = DateTime.utc(bucket.y, bucket.m, 1).startOf("day");
      return dt.toISO();
    }
    return DateTime.utc().toISO();
  } catch (e) {
    return DateTime.utc().toISO();
  }
}

// Controller
// PUBLIC_INTERFACE
async function getServiceUsage(req, res, next) {
  /**
   * Route: GET /api/session-tracking/services
   * Query:
   *  - tenant_id: string (required)
   *  - interval: 'daily'|'weekly'|'monthly'|'custom' (default 'daily')
   *  - start_date, end_date: ISO/Date strings (default: last 30d)
   *  - top: integer [1,50], optional
   *  - status: optional regex string
   *  - include_unknown: boolean; default false
   *  - withTimeBuckets: boolean; when true and interval != 'custom', returns per-bucket results
   */
  try {
    const {
      tenant_id,
      interval = "daily",
      start_date,
      end_date,
      top,
      status,
    } = req.query;

    const include_unknown = toBool(req.query.include_unknown, false);
    const withTimeBuckets = toBool(req.query.withTimeBuckets, false);

    if (!tenant_id || String(tenant_id).trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Missing required query parameter: tenant_id",
      });
    }

    // Sanitize dates
    let start, end;
    if (start_date || end_date) {
      start = parseDate(start_date || "", { startOfDay: true }) || defaultWindow().start;
      end = parseDate(end_date || "", { endOfDay: true }) || defaultWindow().end;
    } else {
      const w = defaultWindow();
      start = w.start;
      end = w.end;
    }

    if (start > end) {
      // Swap if reversed
      const tmp = start;
      start = end;
      end = tmp;
    }

    // Sanitize/top cap
    let topN = undefined;
    if (top !== undefined) {
      const parsed = parseInt(top, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          message: "Invalid 'top' parameter; must be integer >= 1",
        });
      }
      topN = Math.min(parsed, 50);
    }

    // Base match
    const match = buildBaseMatch({ tenant_id, start, end, status });

    const unit = unitForInterval(interval);

    // Debug flag via header for backend verification logs
    const debug = toBool(req.headers["x-debug"] || req.query.debug, false);

    if (withTimeBuckets && unit) {
      // Build bucketed pipeline
      const pipeline = buildBucketedPipeline({
        match,
        includeUnknown: include_unknown,
        unit,
        start,
        end,
      });

      if (debug) {
        console.debug("[services] withTimeBuckets pipeline:", JSON.stringify(pipeline, null, 2));
      }

      const results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

      // Map bucket key to ISO
      const data = results.map((r) => ({
        bucketStart: bucketToISO(r.bucket, unit),
        items: r.items.sort((a, b) => (b.count - a.count) || (a.label || "").localeCompare(b.label || "")),
      }));

      return res.json({
        success: true,
        data,
        meta: {
          interval,
          start: start.toISOString(),
          end: end.toISOString(),
        },
      });
    }

    // Overall aggregation
    const pipeline = buildOverallPipeline({
      match,
      includeUnknown: include_unknown,
      top: topN,
    });

    if (debug) {
      console.debug("[services] overall pipeline:", JSON.stringify(pipeline, null, 2));
    }

    const items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Meta computations
    const total = items.reduce((s, it) => s + (it.count || 0), 0);
    const most = items.length ? items[0] : null;
    const least = items.length ? items[items.length - 1] : null;

    return res.json({
      success: true,
      data: items,
      meta: {
        interval,
        start: start.toISOString(),
        end: end.toISOString(),
        total,
        most,
        least,
      },
    });
  } catch (err) {
    console.error("Error in getServiceUsage:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = {
  getServiceUsage,
};
