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
 * Resolve the incoming date range parameters as UTC instants (no timezone shifting).
 *
 * Contract:
 * - Inputs:
 *   - fromRaw/toRaw: optional strings, either ISO-8601 date-time (preferred) or YYYY-MM-DD.
 * - Behavior:
 *   - ISO date-times are parsed as exact instants (e.g. "2026-03-15T00:00:00.000Z" remains unchanged).
 *   - Date-only (YYYY-MM-DD) expands to full-day UTC bounds:
 *       from => 00:00:00.000Z, to => 23:59:59.999Z
 *   - If both are omitted, defaults to TODAY in UTC (00:00:00.000Z -> 23:59:59.999Z).
 *   - If only one side is provided, the other side is not invented.
 *
 * Returns:
 * - { fromUtc: Date|null, toUtc: Date|null, appliedDefault: boolean }
 */
function resolveUtcWindow(fromRaw, toRaw) {
  const unwrapInput = (s) => {
    if (s === undefined || s === null) return '';
    const str = String(s).trim();
    // Accept ISODate("...") wrapper (some clients use this style)
    const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(str);
    return isoDateWrapped && isoDateWrapped[1]
      ? isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '')
      : str;
  };

  const parseMaybeYmd = (raw, mode) => {
    const s = unwrapInput(raw);
    if (!s) return null;

    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (ymd) {
      const y = Number(ymd[1]);
      const m0 = Number(ymd[2]) - 1;
      const d = Number(ymd[3]);
      return mode === 'from'
        ? new Date(Date.UTC(y, m0, d, 0, 0, 0, 0))
        : new Date(Date.UTC(y, m0, d, 23, 59, 59, 999));
    }

    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const hasFrom = unwrapInput(fromRaw) !== '';
  const hasTo = unwrapInput(toRaw) !== '';

  // Default: TODAY in UTC
  if (!hasFrom && !hasTo) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    return {
      fromUtc: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)),
      toUtc: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)),
      appliedDefault: true,
    };
  }

  return {
    fromUtc: parseMaybeYmd(fromRaw, 'from'),
    toUtc: parseMaybeYmd(toRaw, 'to'),
    appliedDefault: false,
  };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/users
 *
 * Returns aggregated dashboard activity for the requested tenant and date window.
 *
 * Date window contract (important for correctness + debuggability):
 * - Filtering:
 *   - We parse `from`/`to` into UTC instants (JavaScript Date objects) and use those exact instants
 *     in MongoDB filtering. There is no IST (Asia/Kolkata) conversion.
 *   - If `from` and `to` are both omitted, we apply a default "today UTC" window for filtering.
 * - Response echo:
 *   - We echo back the *exact* `from`/`to` strings as passed by the caller (after only unwrapping
 *     ISODate("...") if present). We do NOT replace them with server-derived ISO strings.
 *
 * Query params:
 *  - from?: ISO date-time OR YYYY-MM-DD
 *  - to?:   ISO date-time OR YYYY-MM-DD
 *
 * Response:
 *  - 200: { success, interval, mode, from, to, activity|activityByUser, users }
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

    // Echo back EXACT input values (no timezone shifting, no default override).
    const rawFrom = (req.query?.from === undefined || req.query?.from === null) ? null : String(req.query.from);
    const rawTo = (req.query?.to === undefined || req.query?.to === null) ? null : String(req.query.to);

    // Unwrap ISODate("...") -> "..." for both echo + parsing, but otherwise keep exact strings.
    const unwrapIsoDate = (s) => {
      if (s == null) return null;
      const str = String(s).trim();
      if (!str) return '';
      const m = /^ISODate\((.*)\)$/i.exec(str);
      if (m && m[1]) {
        return m[1].trim().replace(/^['"]|['"]$/g, '');
      }
      return str;
    };

    const echoFrom = rawFrom == null ? null : unwrapIsoDate(rawFrom);
    const echoTo = rawTo == null ? null : unwrapIsoDate(rawTo);

    const { fromUtc, toUtc, appliedDefault } = resolveUtcWindow(echoFrom, echoTo);

    // If caller provided an invalid date string, fail fast with 400
    if ((echoFrom && !fromUtc) || (echoTo && !toUtc)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    // For /api/dashboard/users we must honor the exact request window as passed by the client.
    // No timezone shifting (e.g. IST) and no derived/exclusive bounds are applied here.
    const sessionStartRange = {};
    if (fromUtc) sessionStartRange.$gte = fromUtc;
    if (toUtc) sessionStartRange.$lte = toUtc;

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
     * - Day range selected   => hourly (00-23)
     * - Month-like range     => daily (1-31)
     * - Longer ranges        => monthly (Jan-Dec)
     *
     * We infer this by the number of days covered by [fromUtc, toUtcExclusive).
     */
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const effectiveFrom = fromUtc || new Date();
    const effectiveTo = toUtc || new Date(effectiveFrom.getTime() + MS_PER_DAY);
    const rangeMs = Math.max(0, effectiveTo.getTime() - effectiveFrom.getTime());
    const rangeDays = Math.max(1, Math.ceil(rangeMs / MS_PER_DAY));

    const interval =
      rangeDays <= 2 ? 'hour' : rangeDays <= 62 ? 'day' : 'month';

    // Requirement change:
    // - For ranges <= 31 days: return per-user bucket series with user display names (stacked chart).
    // - For ranges > 31 days: keep aggregated buckets (sessions + distinct users) as before.
    //
    // Notes:
    // - This is inherently calendar-aware: full-month selections (30 or 31 days) stay in per-user mode
    //   because they are <= 31 days.
    const activityMode = rangeDays <= 31 ? 'per_user' : 'aggregated';

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
      res.set('X-Date-Window-Timezone', 'UTC');
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_utc' : 'explicit');

      // Headers reflect effective filter instants (for debugging).
      if (fromUtc) res.set('X-Date-Window-From', fromUtc.toISOString());
      if (toUtc) res.set('X-Date-Window-To', toUtc.toISOString());

      res.set('X-Aggregation-Interval', interval);
      res.set('X-Aggregation-Range-Days', String(rangeDays));
      res.set('X-Activity-Mode', activityMode);
    } catch (_) {}

    return res.status(200).json({
      success: true,
      interval,
      mode: activityMode, // 'per_user' | 'aggregated'

      // IMPORTANT: echo exact input values (post ISODate(...) unwrap), not server-derived instants.
      from: echoFrom,
      to: echoTo,

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
