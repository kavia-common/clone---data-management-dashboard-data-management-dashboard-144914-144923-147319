'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { getDb } = require('../config/db');

const router = express.Router();

/**
 * Normalize the incoming date range parameters and apply default UTC "today" bounds.
 * - If neither from nor to is provided, uses today's UTC full-day window:
 *   from = 00:00:00.000Z, to = 23:59:59.999Z
 * - If date-only "YYYY-MM-DD" is provided, expands to full-day bounds in UTC.
 */
function resolveUtcWindow(fromRaw, toRaw) {
  const parseMaybeYmd = (s, mode) => {
    if (!s) return null;
    const str = String(s).trim();

    // Accept ISODate("...") wrapper (some clients use this style)
    const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(str);
    const unwrapped = isoDateWrapped && isoDateWrapped[1]
      ? isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '')
      : str;

    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(unwrapped);
    if (ymd) {
      const y = Number(ymd[1]);
      const m0 = Number(ymd[2]) - 1;
      const d = Number(ymd[3]);
      return mode === 'from'
        ? new Date(Date.UTC(y, m0, d, 0, 0, 0, 0))
        : new Date(Date.UTC(y, m0, d, 23, 59, 59, 999));
    }

    const dt = new Date(unwrapped);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const hasFrom = fromRaw !== undefined && fromRaw !== null && String(fromRaw).trim() !== '';
  const hasTo = toRaw !== undefined && toRaw !== null && String(toRaw).trim() !== '';

  // Default: TODAY in UTC
  if (!hasFrom && !hasTo) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const from = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, m, d, 23, 59, 59, 999));
    return { from, to, appliedDefault: true };
  }

  const from = parseMaybeYmd(fromRaw, 'from');
  const to = parseMaybeYmd(toRaw, 'to');

  // If caller provided only one side, do not invent the other.
  return { from, to, appliedDefault: false };
}

/**
 * Decide bucket granularity for the UI selection.
 * Mapping required by task:
 *  - selection=days   => bucket by hour
 *  - selection=months => bucket by day
 *  - selection=years  => bucket by month
 */
function resolveBucketGranularity(selection) {
  const s = String(selection || '').trim().toLowerCase();
  if (s === 'days') return 'hour';
  if (s === 'months') return 'day';
  if (s === 'years') return 'month';
  // Default: safest for typical quick ranges (7/14/30/90): daily buckets.
  return 'day';
}

/**
 * Build a MongoDB $dateToString format string for a granularity.
 * We include hour when needed, in UTC, so labels are stable across environments.
 */
function dateToStringFormat(granularity) {
  if (granularity === 'hour') return '%Y-%m-%dT%H:00:00Z';
  if (granularity === 'month') return '%Y-%m';
  // day
  return '%Y-%m-%d';
}

/**
 * Produce a human-readable label for a bucket key.
 * Note: keys are already in UTC-based formats, so we can derive label from the key itself.
 */
function labelFromKey(granularity, key) {
  const k = String(key || '');
  if (granularity === 'hour') {
    // Example: 2026-02-06T13:00:00Z => 13:00
    const m = /T(\d{2}):00:00Z$/.exec(k);
    return m ? `${m[1]}:00` : k;
  }
  if (granularity === 'month') {
    // Example: 2026-02 => Feb 2026
    const [yy, mm] = k.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const idx = Number(mm) - 1;
    return yy && Number.isInteger(idx) && idx >= 0 && idx < 12 ? `${monthNames[idx]} ${yy}` : k;
  }
  // day: keep YYYY-MM-DD (compact and sortable)
  return k;
}

// PUBLIC_INTERFACE
/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/users
 *
 * Returns server-aggregated user analytics for the requested date window.
 *
 * Supports two modes (backward-compatible):
 *  1) Default (no selection): returns per-user totals (existing behavior)
 *  2) Interval-aware (selection=days|months|years):
 *     additionally returns time buckets where the backend aggregates distinct active users per bucket.
 *
 * Query params:
 *  - from?: ISO date-time OR YYYY-MM-DD (expanded to UTC 00:00:00.000Z)
 *  - to?:   ISO date-time OR YYYY-MM-DD (expanded to UTC 23:59:59.999Z)
 *  - selection?: "days" | "months" | "years"
 *
 * Tenant scoping:
 *  - Uses x-organization-id header OR organization_id/tenant_id query OR req.auth tenant.
 *  - Special "T0000" (case-insensitive) means "all tenants" (superadmin/testing).
 *
 * Response (selection provided):
 *  - 200: {
 *      users: Array<{ userId, name, email, totalSessions, distinctProjects, lastActivityAt }>,
 *      buckets: Array<{ key, label, count }>,
 *      meta: { selection, bucketGranularity, from, to }
 *    }
 *
 * Response (no selection):
 *  - 200: Array<{ userId, name, email, totalSessions, distinctProjects, lastActivityAt }>
 */
router.get('/users', async (req, res) => {
  try {
    const tenantHdr = (req.headers?.['x-organization-id'] || '').toString();
    const tenantQuery = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = tenantHdr || tenantQuery || authTenant || '';
    const isAllTenants = requestedTenant && requestedTenant.toUpperCase() === 'T0000';

    // requireTenant middleware already enforces tenant for non-superadmin flows;
    // keep defensive check for non-prod/demo edge cases.
    if (!requestedTenant && !isAllTenants) {
      return res.status(400).json({ success: false, message: 'Missing tenant scope' });
    }

    const { from, to, appliedDefault } = resolveUtcWindow(req.query?.from, req.query?.to);

    // If caller provided an invalid date string, fail fast with 400
    if ((req.query?.from && !from) || (req.query?.to && !to)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const selection = (req.query?.selection || '').toString().trim();
    const wantsBuckets = !!selection;

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    const timeRange = {};
    if (from) timeRange.$gte = from;
    if (to) timeRange.$lte = to;

    // Include a session if ANY of these fields is within the window.
    const timeOr = Object.keys(timeRange).length
      ? [
          { last_updated: timeRange },
          { session_start: timeRange },
          { timestamp: timeRange },
        ]
      : [];

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
    if (timeOr.length) {
      matchAnd.push({ $or: timeOr });
    }

    const matchStage = matchAnd.length ? { $match: { $and: matchAnd } } : { $match: {} };

    // --- Existing per-user totals aggregation (kept as-is for backward compatibility) ---
    const pipeline = [
      matchStage,
      {
        $project: {
          userId: { $toString: '$user_id' },

          // Prefer counting distinct logical sessions via session_id when available.
          // Fallback: use the Mongo _id so each doc counts as one "session-like" unit
          // rather than blowing up with duplicates created by $addToSet(null) etc.
          sessionId: {
            $cond: [
              { $or: [{ $eq: ['$session_id', null] }, { $eq: ['$session_id', ''] }] },
              { $toString: '$_id' },
              { $toString: '$session_id' },
            ],
          },

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
          // FIX: Count distinct sessions, not raw event/docs.
          sessionIds: { $addToSet: '$sessionId' },
          lastActivityAt: { $max: '$activityAt' },
          projectsSet: { $addToSet: '$projectId' },
        },
      },
      {
        $addFields: {
          totalSessions: {
            $size: {
              $filter: {
                input: '$sessionIds',
                as: 's',
                cond: { $and: [{ $ne: ['$$s', null] }, { $ne: ['$$s', ''] }] },
              },
            },
          },
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
                        { $eq: ['$_id', { $convert: { input: '$$uid', to: 'objectId', onError: null, onNull: null } }] },
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

    const rows = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();

    const usersOut = (rows || []).map((r) => ({
      ...r,
      lastActivityAt: r?.lastActivityAt ? new Date(r.lastActivityAt).toISOString() : null,
      totalSessions: Number(r?.totalSessions || 0),
      distinctProjects: Number(r?.distinctProjects || 0),
      userId: String(r?.userId || ''),
      name: r?.name ? String(r.name) : '',
      email: r?.email ? String(r.email) : '',
    }));

    let bucketsOut = [];
    let bucketGranularity = null;

    if (wantsBuckets) {
      bucketGranularity = resolveBucketGranularity(selection);

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
            bucketKey: {
              $dateToString: {
                format: dateToStringFormat(bucketGranularity),
                date: '$activityAt',
                timezone: 'UTC',
              },
            },
          },
        },
        {
          $group: {
            _id: '$bucketKey',
            users: { $addToSet: '$userId' },
          },
        },
        {
          $project: {
            _id: 0,
            key: '$_id',
            count: { $size: '$users' },
          },
        },
        { $sort: { key: 1 } },
      ];

      const bucketRows = await db
        .collection('session_tracking')
        .aggregate(bucketPipeline, { allowDiskUse: true })
        .toArray();

      bucketsOut = (bucketRows || []).map((b) => ({
        key: String(b?.key || ''),
        label: labelFromKey(bucketGranularity, b?.key),
        count: Number(b?.count || 0),
      }));
    }

    try {
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_utc' : 'explicit');
      if (from) res.set('X-Date-Window-From', from.toISOString());
      if (to) res.set('X-Date-Window-To', to.toISOString());
      if (wantsBuckets) {
        res.set('X-Users-Analytics-Selection', selection);
        res.set('X-Users-Analytics-Bucket-Granularity', bucketGranularity);
      }
    } catch (_) {}

    if (!wantsBuckets) {
      return res.status(200).json(usersOut);
    }

    return res.status(200).json({
      users: usersOut,
      buckets: bucketsOut,
      meta: {
        selection,
        bucketGranularity,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard.users] error:', err?.message || err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
