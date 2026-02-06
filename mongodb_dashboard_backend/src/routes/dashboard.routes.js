'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireTenant } = require('../middleware/requireTenant');
const { getDb } = require('../config/db');
const { attachAuthContext } = require('../middleware/auth');

const router = express.Router();

/**
 * Auth/tenant handling parity note:
 * - /api/users works without a JWT in demo/testing flows as long as a tenant is provided via
 *   x-organization-id header or ?organization_id/?tenant_id query.
 * - /api/dashboard/users must behave the same way (no surprise 401), while still enforcing
 *   tenant scope via requireTenant.
 *
 * Therefore:
 * - We attach best-effort auth context (req.user) if an Authorization header is present.
 * - We ALWAYS require tenant scope (requireTenant), which also enforces JWT tenant mismatch (403).
 * - We do NOT hard-require Authorization here.
 */
router.use(attachAuthContext(), requireTenant);

// Early detector for T0000 (super admin) at dashboard overview module
router.use((req, res, next) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = hdr || qOrg || authTenant || '';
    const isT0000 = requestedTenant && requestedTenant.toUpperCase() === 'T0000';
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.dashboardAllTenantsBypass = true;
      try {
        res.set('X-All-Tenants', 'true');
      } catch (_) {}
    }
    console.log('[dashboard.routes] bypass check', { requestedTenant, isT0000, bypassApplied: !!isT0000 });
  } catch (_) {}
  next();
});

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard overview endpoints
 */

/**
 * Resolve the incoming date range parameters as IST (Asia/Kolkata) calendar days,
 * then convert to UTC bounds suitable for MongoDB matching.
 *
 * Behavior:
 * - `from` / `to` are typically passed as YYYY-MM-DD (Quick Range inputs).
 * - We interpret these as IST-local days:
 *    - fromIST: YYYY-MM-DD 00:00:00.000 IST
 *    - toISTExclusive: (YYYY-MM-DD + 1 day) 00:00:00.000 IST
 * - We convert both instants to UTC and apply to `session_start` as:
 *    session_start: { $gte: fromUtc, $lt: toUtcExclusive }
 *
 * Notes:
 * - We use $lt with an exclusive upper bound (next-day start) which avoids
 *   millisecond precision issues and matches common range semantics.
 * - If neither from nor to is provided, we default to "today" in IST.
 */
function resolveIstDayWindowToUtcBounds(fromRaw, toRaw) {
  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // UTC+05:30

  const unwrapInput = (s) => {
    if (s === undefined || s === null) return '';
    const str = String(s).trim();
    // Accept ISODate("...") wrapper (some clients use this style)
    const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(str);
    return isoDateWrapped && isoDateWrapped[1]
      ? isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '')
      : str;
  };

  const parseYmd = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return { y: Number(m[1]), m0: Number(m[2]) - 1, d: Number(m[3]) };
  };

  // Build a Date representing the specified IST-local time expressed as a UTC instant.
  // Example: 2026-01-01 00:00 IST == 2025-12-31 18:30Z
  const istLocalToUtcInstant = (y, m0, d, hh, mm, ss, ms) => {
    // Construct the instant as if the inputs were UTC, then subtract the IST offset.
    // This is safe here because IST has no DST transitions.
    const asUtc = Date.UTC(y, m0, d, hh, mm, ss, ms);
    return new Date(asUtc - IST_OFFSET_MS);
  };

  const hasFrom = unwrapInput(fromRaw) !== '';
  const hasTo = unwrapInput(toRaw) !== '';

  // Default: TODAY in IST
  if (!hasFrom && !hasTo) {
    const nowUtc = new Date();
    // Convert "now" instant to IST-local time by adding offset, then read UTC fields.
    const nowIstInstant = new Date(nowUtc.getTime() + IST_OFFSET_MS);
    const y = nowIstInstant.getUTCFullYear();
    const m0 = nowIstInstant.getUTCMonth();
    const d = nowIstInstant.getUTCDate();

    const fromUtc = istLocalToUtcInstant(y, m0, d, 0, 0, 0, 0);
    const toUtcExclusive = istLocalToUtcInstant(y, m0, d + 1, 0, 0, 0, 0);

    return {
      fromUtc,
      toUtcExclusive,
      fromIst: new Date(fromUtc.getTime() + IST_OFFSET_MS),
      toIstExclusive: new Date(toUtcExclusive.getTime() + IST_OFFSET_MS),
      appliedDefault: true,
    };
  }

  // Explicit inputs: prefer YYYY-MM-DD.
  // If callers send full ISO timestamps, we still attempt to accept them by converting the instant
  // to IST and extracting the IST day (this preserves "calendar day" intent as best as possible).
  const parseToIstDay = (raw) => {
    const unwrapped = unwrapInput(raw);
    if (!unwrapped) return null;

    const ymd = parseYmd(unwrapped);
    if (ymd) return ymd;

    const dt = new Date(unwrapped);
    if (Number.isNaN(dt.getTime())) return null;

    const istInstant = new Date(dt.getTime() + IST_OFFSET_MS);
    return { y: istInstant.getUTCFullYear(), m0: istInstant.getUTCMonth(), d: istInstant.getUTCDate() };
  };

  const fromDay = parseToIstDay(fromRaw);
  const toDay = parseToIstDay(toRaw);

  // Only apply bounds that were provided; do not invent the missing side.
  const fromUtc = fromDay ? istLocalToUtcInstant(fromDay.y, fromDay.m0, fromDay.d, 0, 0, 0, 0) : null;
  const toUtcExclusive = toDay ? istLocalToUtcInstant(toDay.y, toDay.m0, toDay.d + 1, 0, 0, 0, 0) : null;

  return {
    fromUtc,
    toUtcExclusive,
    fromIst: fromUtc ? new Date(fromUtc.getTime() + IST_OFFSET_MS) : null,
    toIstExclusive: toUtcExclusive ? new Date(toUtcExclusive.getTime() + IST_OFFSET_MS) : null,
    appliedDefault: false,
  };
}

/**
 * Decide bucket granularity based on the requested from/to window length.
 * Requirement (backend-driven inference):
 *  - day-range   => bucket by hour
 *  - month-range => bucket by day
 *  - year-range  => bucket by month
 *
 * We infer based on the number of days between the effective bounds.
 */
function inferBucketGranularityFromWindow(fromUtc, toUtcExclusive) {
  const fromMs = fromUtc?.getTime?.();
  const toMs = toUtcExclusive?.getTime?.();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    // If missing/invalid bounds, default to day buckets (safe).
    return 'day';
  }

  const days = (toMs - fromMs) / (24 * 60 * 60 * 1000);

  // Heuristics:
  // - up to ~2 days => hourly
  // - up to ~62 days (~2 months) => daily
  // - above that => monthly
  if (days <= 2.1) return 'hour';
  if (days <= 62) return 'day';
  return 'month';
}

function labelFromBucketDate(granularity, dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (granularity === 'hour') {
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${hh}:00`;
  }
  if (granularity === 'month') {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  // day
  return d.toISOString().slice(0, 10);
}

function keyFromBucketDate(granularity, dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (granularity === 'hour') {
    // YYYY-MM-DDTHH:00:00Z
    const iso = d.toISOString();
    return `${iso.slice(0, 13)}:00:00Z`;
  }
  if (granularity === 'month') {
    // YYYY-MM
    return d.toISOString().slice(0, 7);
  }
  // day: YYYY-MM-DD
  return d.toISOString().slice(0, 10);
}

/**
 * Ensure chart readability by returning evenly spaced intervals.
 * - hour:  00..23 (24 buckets)
 * - day:   each calendar day from start..end (inclusive)
 * - month: Jan..Dec for any year-range; for multi-year windows we still output all months present
 *
 * We build the full bucket list and fill missing counts with 0 so the frontend never needs to aggregate
 * or generate ticks.
 */
function buildExpectedBucketStartsUtc(granularity, fromUtc, toUtcExclusive) {
  if (!fromUtc || !toUtcExclusive) return [];

  const starts = [];
  const from = new Date(fromUtc);
  const toExclusive = new Date(toUtcExclusive);

  if (granularity === 'hour') {
    // For "day range", UI expects 00-23 (hours of day). We emit all 24 hours across the range start day in UTC.
    // Note: because our range semantics are IST-day converted to UTC instants, this UTC-day could straddle two UTC dates,
    // but the X-axis requirement is "00-23". We choose the first UTC day intersecting the range: fromUtc's UTC date.
    const y = from.getUTCFullYear();
    const m0 = from.getUTCMonth();
    const d = from.getUTCDate();
    for (let h = 0; h < 24; h += 1) {
      starts.push(new Date(Date.UTC(y, m0, d, h, 0, 0, 0)));
    }
    return starts;
  }

  if (granularity === 'day') {
    // Iterate days (UTC) from start day to last day inclusive.
    const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0));
    const endInclusive = new Date(toExclusive.getTime() - 1); // last instant included
    const endDay = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), endInclusive.getUTCDate(), 0, 0, 0, 0));
    while (cur.getTime() <= endDay.getTime()) {
      starts.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return starts;
  }

  // month
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1, 0, 0, 0, 0));
  const endInclusive = new Date(toExclusive.getTime() - 1);
  const endMonth = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth(), 1, 0, 0, 0, 0));
  while (cur.getTime() <= endMonth.getTime()) {
    starts.push(new Date(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return starts;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/users
 *
 * Standardized response contract (always an envelope):
 *  - 200: {
 *      success: true,
 *      data: {
 *        users: Array<{ userId, name, email, totalSessions, distinctProjects, lastActivityAt }>,
 *        buckets: Array<{ key, label, count }>,
 *        totals: { totalUsers, totalSessions, distinctProjects }
 *      },
 *      meta: {
 *        interval: "hour"|"day"|"month",
 *        fromUtc: string|null,
 *        toUtcExclusive: string|null,
 *        fromIst: string|null,
 *        toIstExclusive: string|null,
 *        tenant: string|null,
 *        allTenants: boolean,
 *        appliedDefault: boolean
 *      }
 *    }
 *
 * Backend-driven aggregation rules (mandatory):
 * - Day range   => hourly buckets (00-23)
 * - Month range => daily buckets (1-31 shown via YYYY-MM-DD keys/labels)
 * - Year range  => monthly buckets (Jan-Dec labels)
 *
 * Query params:
 *  - from?: ISO date-time OR YYYY-MM-DD (interpreted as IST calendar day)
 *  - to?:   ISO date-time OR YYYY-MM-DD (interpreted as IST calendar day; exclusive next day for filtering)
 *
 * Notes:
 * - This endpoint does NOT send raw session records; it returns already bucketed counts.
 * - Frontend should not aggregate; it should consume buckets directly.
 */
router.get('/users', async (req, res) => {
  try {
    const tenantHdr = (req.headers?.['x-organization-id'] || '').toString();
    const tenantQuery = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = tenantHdr || tenantQuery || authTenant || '';
    const isAllTenants = requestedTenant && requestedTenant.toUpperCase() === 'T0000';

    // requireTenant middleware already enforces tenant for non-superadmin flows;
    // still keep a defensive check for demo/test paths.
    if (!requestedTenant && !isAllTenants) {
      return res.status(400).json({ success: false, message: 'Missing tenant scope' });
    }

    const hasFrom = req.query?.from !== undefined && req.query?.from !== null && String(req.query.from).trim() !== '';
    const hasTo = req.query?.to !== undefined && req.query?.to !== null && String(req.query.to).trim() !== '';

    const { fromUtc, toUtcExclusive, fromIst, toIstExclusive, appliedDefault } = resolveIstDayWindowToUtcBounds(
      req.query?.from,
      req.query?.to
    );

    // If caller provided an invalid date string, fail fast with 400
    if ((hasFrom && !fromUtc) || (hasTo && !toUtcExclusive)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    // For /api/dashboard/users we filter ONLY on `session_start` using IST-derived calendar day bounds converted to UTC
    const sessionStartRange = {};
    if (fromUtc) sessionStartRange.$gte = fromUtc;
    if (toUtcExclusive) sessionStartRange.$lt = toUtcExclusive;

    const matchAnd = [];
    if (!isAllTenants) {
      matchAnd.push({
        $or: [
          { tenant_id: requestedTenant },
          { organization_id: requestedTenant },
          { organizationId: requestedTenant },
          { tenantId: requestedTenant },
          { orgId: requestedTenant },
          { 'tenant.tenant_id': requestedTenant },
        ],
      });
    }
    if (Object.keys(sessionStartRange).length) {
      matchAnd.push({ session_start: sessionStartRange });
    }

    const matchStage = matchAnd.length ? { $match: { $and: matchAnd } } : { $match: {} };

    // Per-user totals (list table content).
    const usersPipeline = [
      matchStage,
      {
        $project: {
          userId: { $toString: '$user_id' },
          projectId: {
            $cond: [
              { $or: [{ $eq: ['$project_id', null] }, { $eq: ['$project_id', ''] }] },
              null,
              { $toString: '$project_id' },
            ],
          },
          activityAt: { $ifNull: ['$last_updated', { $ifNull: ['$session_start', '$timestamp'] }] },
        },
      },
      // Guard: sessions without a user id should not be included.
      { $match: { userId: { $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$userId',
          totalSessions: { $sum: 1 },
          lastActivityAt: { $max: '$activityAt' },
          projectsSet: { $addToSet: '$projectId' },
        },
      },
      {
        $addFields: {
          distinctProjects: {
            $size: {
              $filter: {
                input: '$projectsSet',
                as: 'p',
                cond: { $and: [{ $ne: ['$$p', null] }, { $ne: ['$$p', ''] }] },
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: 'users',
          let: { uid: '$_id' },
          pipeline: [
            {
              $match: {
                // Match either _id(ObjectId) == uid OR user_id(string) == uid
                $expr: {
                  $or: [
                    {
                      $and: [
                        { $eq: [{ $type: '$_id' }, 'objectId'] },
                        {
                          $eq: [
                            '$_id',
                            { $convert: { input: '$$uid', to: 'objectId', onError: null, onNull: null } },
                          ],
                        },
                      ],
                    },
                    { $eq: ['$user_id', '$$uid'] },
                    { $eq: [{ $toString: '$_id' }, '$$uid'] },
                  ],
                },
              },
            },
            {
              $project: {
                _id: 1,
                email: 1,
                name: 1,
                full_name: 1,
                fullName: 1,
                displayName: 1,
                display_name: 1,
                user_name: 1,
              },
            },
          ],
          as: 'userDoc',
        },
      },
      { $unwind: { path: '$userDoc', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          name: {
            $ifNull: [
              '$userDoc.name',
              {
                $ifNull: [
                  '$userDoc.full_name',
                  {
                    $ifNull: [
                      '$userDoc.fullName',
                      { $ifNull: ['$userDoc.displayName', { $ifNull: ['$userDoc.display_name', '$userDoc.user_name'] }] },
                    ],
                  },
                ],
              },
            ],
          },
          email: { $ifNull: ['$userDoc.email', null] },
        },
      },
      {
        $project: {
          _id: 0,
          userId: '$_id',
          name: 1,
          email: 1,
          totalSessions: 1,
          distinctProjects: 1,
          lastActivityAt: 1,
        },
      },
      { $sort: { lastActivityAt: -1, totalSessions: -1 } },
    ];

    const userRows = await db.collection('session_tracking').aggregate(usersPipeline, { allowDiskUse: true }).toArray();

    // Normalize lastActivityAt to ISO for stable contract
    const usersOut = (userRows || []).map((r) => ({
      ...r,
      lastActivityAt: r?.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
      totalSessions: Number(r?.totalSessions || 0),
      distinctProjects: Number(r?.distinctProjects || 0),
      userId: String(r?.userId || ''),
      name: r?.name ? String(r.name) : '',
      email: r?.email ? String(r.email) : '',
    }));

    const interval = inferBucketGranularityFromWindow(fromUtc, toUtcExclusive);

    // Buckets: distinct active users per bucket (chart series).
    // We use $dateTrunc for correct bucketing; then fill missing buckets with 0 for readability.
    const bucketPipeline = [
      matchStage,
      {
        $project: {
          userId: { $toString: '$user_id' },
          activityAt: { $ifNull: ['$last_updated', { $ifNull: ['$session_start', '$timestamp'] }] },
        },
      },
      { $match: { userId: { $ne: null, $ne: '' }, activityAt: { $ne: null } } },
      {
        $addFields: {
          bucketStart: {
            $dateTrunc: {
              date: '$activityAt',
              unit: interval,
              timezone: 'UTC',
            },
          },
        },
      },
      {
        $group: {
          _id: '$bucketStart',
          users: { $addToSet: '$userId' },
        },
      },
      {
        $project: {
          _id: 0,
          bucketStart: '$_id',
          count: { $size: '$users' },
        },
      },
      { $sort: { bucketStart: 1 } },
    ];

    const bucketRows = await db.collection('session_tracking').aggregate(bucketPipeline, { allowDiskUse: true }).toArray();

    const countByKey = new Map(
      (bucketRows || []).map((b) => [keyFromBucketDate(interval, b?.bucketStart), Number(b?.count || 0)])
    );

    const expectedStarts = buildExpectedBucketStartsUtc(interval, fromUtc, toUtcExclusive);
    const bucketsOut = expectedStarts.map((dt) => {
      const key = keyFromBucketDate(interval, dt);
      return {
        key,
        label: labelFromBucketDate(interval, dt),
        count: countByKey.get(key) || 0,
      };
    });

    // Current totals (for the selected window)
    const totals = usersOut.reduce(
      (acc, u) => {
        acc.totalUsers += 1;
        acc.totalSessions += Number(u?.totalSessions || 0);
        acc.distinctProjects += Number(u?.distinctProjects || 0);
        return acc;
      },
      { totalUsers: 0, totalSessions: 0, distinctProjects: 0 }
    );

    try {
      res.set('X-Date-Window-Timezone', 'Asia/Kolkata');
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_ist' : 'explicit_ist');
      if (fromIst) res.set('X-Date-Window-From-IST', fromIst.toISOString());
      if (toIstExclusive) res.set('X-Date-Window-To-IST', toIstExclusive.toISOString());
      if (fromUtc) res.set('X-Date-Window-From-UTC', fromUtc.toISOString());
      if (toUtcExclusive) res.set('X-Date-Window-To-UTC', toUtcExclusive.toISOString());
      res.set('X-Users-Analytics-Interval', interval);
    } catch (_) {}

    return res.status(200).json({
      success: true,
      data: {
        users: usersOut,
        buckets: bucketsOut,
        totals,
      },
      meta: {
        interval,
        fromUtc: fromUtc ? fromUtc.toISOString() : null,
        toUtcExclusive: toUtcExclusive ? toUtcExclusive.toISOString() : null,
        fromIst: fromIst ? fromIst.toISOString() : null,
        toIstExclusive: toIstExclusive ? toIstExclusive.toISOString() : null,
        tenant: requestedTenant || null,
        allTenants: !!isAllTenants,
        appliedDefault: !!appliedDefault,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard.users] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// PUBLIC_INTERFACE
router.get('/metrics', (req, res) => {
  // Controller was removed along with Overview charts; keep endpoint to avoid breaking clients/tests.
  return res.status(404).json({ success: false, message: 'Overview metrics endpoint removed' });
});

module.exports = router;
