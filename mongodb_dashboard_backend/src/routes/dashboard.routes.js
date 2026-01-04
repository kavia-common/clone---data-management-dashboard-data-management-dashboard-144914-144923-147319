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

  // If caller provided only one side, do not invent the other; match will use only provided bound.
  return { from, to, appliedDefault: false };
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

    const { from, to, appliedDefault } = resolveUtcWindow(req.query?.from, req.query?.to);

    // If caller provided an invalid date string, fail fast with 400
    if ((req.query?.from && !from) || (req.query?.to && !to)) {
      return res.status(400).json({ success: false, message: 'Invalid from/to date value(s)' });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;
    if (!db) {
      return res.status(503).json({ success: false, message: 'Database not connected' });
    }

    const timeRange = {};
    if (from) timeRange.$gte = from;
    if (to) timeRange.$lte = to;

    // Activity time is derived from last_updated (preferred) then session_start then timestamp.
    // For filtering, we include a session if ANY of these fields is within the window.
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
      res.set('X-Date-Window-Applied', appliedDefault ? 'default_today_utc' : 'explicit');
      if (from) res.set('X-Date-Window-From', from.toISOString());
      if (to) res.set('X-Date-Window-To', to.toISOString());
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
