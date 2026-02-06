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
      try { res.set('X-All-Tenants', 'true'); } catch (_) {}
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
 * PUBLIC_INTERFACE
 * GET /api/dashboard/users
 *
 * Returns fully aggregated per-user analytics for the requested date window.
 * The backend is the sole source of analytics data: it filters, groups, counts,
 * joins user metadata, and sorts by activity (lastActivityAt desc).
 *
 * Query params:
 *  - from?: ISO date-time OR YYYY-MM-DD
 *  - to?:   ISO date-time OR YYYY-MM-DD
 *
 * Notes on date handling:
 *  - If YYYY-MM-DD is provided (Quick Range/custom date inputs), the backend interprets the
 *    values as IST (Asia/Kolkata) calendar days and converts them to UTC bounds for matching
 *    against session_start:
 *      from => YYYY-MM-DD 00:00:00.000 IST (converted to UTC)
 *      to   => (YYYY-MM-DD + 1 day) 00:00:00.000 IST (converted to UTC, exclusive)
 *  - If ISO timestamps are provided, the backend extracts the IST calendar day and applies
 *    the same IST-day semantics.
 *
 * Default behavior:
 *  - If both from and to are omitted, defaults to TODAY in UTC:
 *    00:00:00.000Z -> 23:59:59.999Z
 *
 * Response:
 *  - 200: Array<{ userId, name, email, totalSessions, distinctProjects, lastActivityAt, projects?: [...] }>
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

    const { fromUtc, toUtcExclusive, fromIst, toIstExclusive, appliedDefault } =
      resolveIstDayWindowToUtcBounds(req.query?.from, req.query?.to);

    // If caller provided an invalid date string, fail fast with 400
    if ((req.query?.from && !fromUtc) || (req.query?.to && !toUtcExclusive)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    // NOTE(product requirement): For /api/dashboard/users we intentionally filter ONLY on
    // `session_start` using IST-derived calendar day bounds converted to UTC:
    // session_start: { $gte: <fromIST start as UTC>, $lt: <toIST next-day start as UTC> }
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

    /**
     * Decide aggregation interval based on overall date-range length.
     *
     * Interval Rules (per requirement):
     * - Day range selected  => hourly (00-23)
     * - Month range selected => daily (1-31)
     * - Year range selected  => monthly (Jan-Dec)
     *
     * We infer "day/month/year" by the number of days covered by [fromUtc, toUtcExclusive).
     */
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const effectiveFrom = fromUtc || new Date();
    const effectiveTo = toUtcExclusive || new Date(effectiveFrom.getTime() + MS_PER_DAY);
    const rangeMs = Math.max(0, effectiveTo.getTime() - effectiveFrom.getTime());
    const rangeDays = Math.max(1, Math.ceil(rangeMs / MS_PER_DAY));

    const interval =
      rangeDays <= 2 ? 'hour' : rangeDays <= 62 ? 'day' : 'month';

    // Requirement change:
    // - For ranges < 30 days: return per-user bucket series with user display names (stacked chart).
    // - For ranges >= 30 days: keep aggregated buckets (sessions + distinct users) as before.
    const activityMode = rangeDays < 30 ? 'per_user' : 'aggregated';

    // Bucket key + label expressions (UTC).
    // Important: since we match on session_start bounded by IST-derived UTC instants,
    // grouping is still done in UTC instants. That's OK: the requirement is about
    // readable x-axis intervals, not local-time bucketing.
    const bucketProject =
      interval === 'hour'
        ? {
            bucketKey: {
              $dateToString: { format: '%Y-%m-%dT%H:00:00.000Z', date: '$session_start' },
            },
            bucketLabel: {
              $dateToString: { format: '%H', date: '$session_start' },
            },
            bucketSort: { $toLong: { $dateTrunc: { date: '$session_start', unit: 'hour' } } },
          }
        : interval === 'day'
          ? {
              bucketKey: {
                $dateToString: { format: '%Y-%m-%d', date: '$session_start' },
              },
              bucketLabel: {
                // Day-of-month label: 1..31 (no leading 0)
                $toString: { $dayOfMonth: '$session_start' },
              },
              bucketSort: { $toLong: { $dateTrunc: { date: '$session_start', unit: 'day' } } },
            }
          : {
              bucketKey: {
                $dateToString: { format: '%Y-%m', date: '$session_start' },
              },
              bucketLabel: {
                // Month label short (Jan..Dec) using a fixed year to avoid locale inconsistencies in Mongo
                $let: {
                  vars: { m: { $month: '$session_start' } },
                  in: {
                    $arrayElemAt: [
                      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                      { $subtract: ['$$m', 1] },
                    ],
                  },
                },
              },
              bucketSort: { $toLong: { $dateTrunc: { date: '$session_start', unit: 'month' } } },
            };

    /**
     * Aggregated-mode buckets: identical to prior behavior.
     * Output: Array<{ key, label, sessions, users }>
     */
    const aggregatedActivityPipeline = [
      matchStage,
      {
        $addFields: {
          userId: { $toString: '$user_id' },
          sessionStart: '$session_start',
        },
      },
      { $match: { userId: { $ne: null, $ne: '' }, sessionStart: { $ne: null } } },
      {
        $addFields: {
          session_start: '$sessionStart',
          ...bucketProject,
        },
      },
      {
        $group: {
          _id: '$bucketKey',
          label: { $first: '$bucketLabel' },
          sort: { $max: '$bucketSort' },
          sessions: { $sum: 1 },
          userIds: { $addToSet: '$userId' },
        },
      },
      {
        $addFields: {
          users: {
            $size: {
              $filter: {
                input: '$userIds',
                as: 'u',
                cond: { $and: [{ $ne: ['$$u', null] }, { $ne: ['$$u', ''] }] },
              },
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          key:
            interval === 'hour'
              ? '$label'
              : interval === 'day'
                ? { $toString: { $toInt: '$label' } }
                : interval === 'month'
                  ? {
                      $toString: {
                        $add: [
                          1,
                          {
                            $indexOfArray: [
                              ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                              '$label',
                            ],
                          },
                        ],
                      },
                    }
                  : '$_id',
          label: 1,
          sessions: 1,
          users: 1,
          sort: 1,
        },
      },
      { $sort: { sort: 1 } },
    ];

    /**
     * Per-user-mode buckets (<30 days):
     * Output: {
     *   buckets: Array<{ key, label }>,
     *   series: Array<{ userId, name, sessionsByKey: { [key]: number } }>
     * }
     *
     * Notes:
     * - We keep bucket "key" compatible with the existing frontend templating logic (00-23, 1-31, 1-12).
     * - We join user display names via users collection.
     */
    const perUserActivityPipeline = [
      matchStage,
      {
        $addFields: {
          userId: { $toString: '$user_id' },
          sessionStart: '$session_start',
        },
      },
      { $match: { userId: { $ne: null, $ne: '' }, sessionStart: { $ne: null } } },
      {
        $addFields: {
          session_start: '$sessionStart',
          ...bucketProject,
        },
      },
      // 1) Count sessions per (userId, bucketKey)
      {
        $group: {
          _id: { userId: '$userId', bucketKey: '$bucketKey' },
          label: { $first: '$bucketLabel' },
          sort: { $max: '$bucketSort' },
          sessions: { $sum: 1 },
        },
      },
      // 2) Remap bucketKey to frontend-stable key (00-23, 1-31, 1-12)
      {
        $addFields: {
          key:
            interval === 'hour'
              ? '$label'
              : interval === 'day'
                ? { $toString: { $toInt: '$label' } }
                : interval === 'month'
                  ? {
                      $toString: {
                        $add: [
                          1,
                          {
                            $indexOfArray: [
                              ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                              '$label',
                            ],
                          },
                        ],
                      },
                    }
                  : '$_id.bucketKey',
          userId: '$_id.userId',
        },
      },
      // 3) Join user metadata for display name
      {
        $lookup: {
          from: 'users',
          let: { uid: '$userId' },
          pipeline: [
            {
              $match: {
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
          userName: {
            $ifNull: [
              '$userDoc.name',
              {
                $ifNull: [
                  '$userDoc.full_name',
                  {
                    $ifNull: [
                      '$userDoc.fullName',
                      {
                        $ifNull: [
                          '$userDoc.displayName',
                          { $ifNull: ['$userDoc.display_name', '$userDoc.user_name'] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          userEmail: { $ifNull: ['$userDoc.email', null] },
        },
      },
      // 4) Reshape into per-user rows with a sessionsByKey object and a buckets list
      {
        $group: {
          _id: '$userId',
          name: { $first: '$userName' },
          email: { $first: '$userEmail' },
          totalSessions: { $sum: '$sessions' },
          points: { $push: { key: '$key', label: '$label', sort: '$sort', sessions: '$sessions' } },
          buckets: { $addToSet: { key: '$key', label: '$label', sort: '$sort' } },
        },
      },
      { $sort: { totalSessions: -1 } },
    ];

    let normalizedBuckets = [];
    let perUserActivity = null;

    if (activityMode === 'aggregated') {
      const buckets = await db
        .collection('session_tracking')
        .aggregate(aggregatedActivityPipeline, { allowDiskUse: true })
        .toArray();

      normalizedBuckets = (buckets || []).map((b) => ({
        key: String(b?.key || ''),
        label: String(b?.label || ''),
        sessions: Number(b?.sessions || 0),
        users: Number(b?.users || 0),
      }));
    } else {
      const perUserRows = await db
        .collection('session_tracking')
        .aggregate(perUserActivityPipeline, { allowDiskUse: true })
        .toArray();

      // Buckets are duplicated across users; consolidate and sort by bucket.sort
      const bucketMap = new Map();
      (perUserRows || []).forEach((u) => {
        (u?.buckets || []).forEach((b) => {
          const key = String(b?.key || '').trim();
          if (!key) return;
          if (!bucketMap.has(key)) {
            bucketMap.set(key, { key, label: String(b?.label || ''), sort: Number(b?.sort || 0) });
          }
        });
      });

      const sortedBuckets = Array.from(bucketMap.values()).sort((a, b) => a.sort - b.sort);

      const series = (perUserRows || []).map((u) => {
        const sessionsByKey = {};
        (u?.points || []).forEach((p) => {
          const k = String(p?.key || '').trim();
          if (!k) return;
          sessionsByKey[k] = (sessionsByKey[k] || 0) + Number(p?.sessions || 0);
        });

        const display =
          (u?.name && String(u.name).trim()) ||
          (u?.email && String(u.email).trim()) ||
          (u?._id ? `User ${String(u._id).slice(0, 8)}` : 'User');

        return {
          userId: String(u?._id || ''),
          name: String(display),
          totalSessions: Number(u?.totalSessions || 0),
          sessionsByKey,
        };
      });

      perUserActivity = {
        buckets: sortedBuckets.map((b) => ({ key: b.key, label: b.label })),
        series,
      };

      // In per-user mode, we return `activity` as null and use `activityByUser` instead.
      normalizedBuckets = [];
    }

    // Keep the prior per-user analytics response available for backward compatibility
    // (other screens may rely on it). The frontend chart change in this task will read `activity`.
    const perUserPipeline = [
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
                      {
                        $ifNull: [
                          '$userDoc.displayName',
                          { $ifNull: ['$userDoc.display_name', '$userDoc.user_name'] },
                        ],
                      },
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

    const perUserRows = await db
      .collection('session_tracking')
      .aggregate(perUserPipeline, { allowDiskUse: true })
      .toArray();

    const perUser = (perUserRows || []).map((r) => ({
      ...r,
      lastActivityAt: r?.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
      totalSessions: Number(r?.totalSessions || 0),
      distinctProjects: Number(r?.distinctProjects || 0),
      userId: String(r?.userId || ''),
      name: r?.name ? String(r.name) : '',
      email: r?.email ? String(r.email) : '',
    }));

    try {
      res.set('X-Date-Window-Timezone', 'Asia/Kolkata');
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_ist' : 'explicit_ist');

      if (fromIst) res.set('X-Date-Window-From-IST', fromIst.toISOString());
      if (toIstExclusive) res.set('X-Date-Window-To-IST', toIstExclusive.toISOString());

      if (fromUtc) res.set('X-Date-Window-From-UTC', fromUtc.toISOString());
      if (toUtcExclusive) res.set('X-Date-Window-To-UTC', toUtcExclusive.toISOString());

      res.set('X-Aggregation-Interval', interval);
      res.set('X-Aggregation-Range-Days', String(rangeDays));
      res.set('X-Activity-Mode', activityMode);
    } catch (_) {}

    return res.status(200).json({
      success: true,
      interval,
      mode: activityMode, // 'per_user' | 'aggregated'
      from: fromUtc ? fromUtc.toISOString() : null,
      to: toUtcExclusive ? toUtcExclusive.toISOString() : null,

      // Long ranges (>=30 days): keep existing aggregated buckets.
      activity: activityMode === 'aggregated' ? normalizedBuckets : null,

      // Short ranges (<30 days): return per-user stacked series.
      activityByUser: activityMode === 'per_user' ? perUserActivity : null,

      // Backward compatibility: keep the previous response available.
      users: perUser,
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
