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
 *  - from?: ISO date-time OR YYYY-MM-DD (expanded to UTC 00:00:00.000Z)
 *  - to?:   ISO date-time OR YYYY-MM-DD (expanded to UTC 23:59:59.999Z)
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

    // Aggregation pipeline:
    // - match by tenant + time window (default TODAY UTC if omitted)
    // - project normalized ids, project_id, and activity time
    // - group by user => totalSessions, distinctProjects, lastActivityAt
    // - lookup user metadata
    // - shape stable response fields
    // - sort by activity
    const pipeline = [
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
          // Optional for future use; keep stable response but do not include heavy arrays by default.
          // projects: '$projectsSet',
        },
      },
      { $sort: { lastActivityAt: -1, totalSessions: -1 } },
    ];

    const rows = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();

    // Normalize lastActivityAt to ISO for a stable frontend contract.
    const out = (rows || []).map((r) => ({
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
    } catch (_) {}

    return res.status(200).json(out);
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
