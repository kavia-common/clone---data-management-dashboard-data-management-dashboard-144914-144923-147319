'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireTenant } = require('../middleware/requireTenant');
const { getDb } = require('../config/db');
const { attachAuthContext } = require('../middleware/auth');

const router = express.Router();

router.use(attachAuthContext(), requireTenant);

/**
 * Resolve date range for dashboard analytics.
 *
 * IMPORTANT INVARIANT (matches Mongo validation semantics):
 * - The date filter for /api/dashboard/users MUST be applied ONLY on session_start.
 * - When the client sends a day selector (YYYY-MM-DD), it MUST expand to strict UTC day bounds:
 *     fromUtc = 00:00:00.000Z
 *     toUtc   = 23:59:59.999Z
 * - When the client sends an ISO instant (date-time), it MUST be treated as an instant (no clamping).
 * - Invalid provided date inputs must fail fast (400) so we never accidentally widen the query.
 */
function resolveUtcDayWindowToUtcBounds(fromRaw, toRaw) {
  const unwrapInput = (s) => {
    if (s === undefined || s === null) return '';
    const str = String(s).trim();

    // Accept ISODate("...") wrapper (some clients/logs use Mongo-shell style)
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

  const parseSide = (raw, mode) => {
    const unwrapped = unwrapInput(raw);
    if (!unwrapped) return null;

    const ymd = parseYmd(unwrapped);
    if (ymd) {
      return mode === 'from'
        ? new Date(Date.UTC(ymd.y, ymd.m0, ymd.d, 0, 0, 0, 0))
        : new Date(Date.UTC(ymd.y, ymd.m0, ymd.d, 23, 59, 59, 999));
    }

    const dt = new Date(unwrapped);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  };

  const hasFrom = fromRaw !== undefined && fromRaw !== null && String(fromRaw).trim() !== '';
  const hasTo = toRaw !== undefined && toRaw !== null && String(toRaw).trim() !== '';

  // Default = today UTC (only when both omitted)
  if (!hasFrom && !hasTo) {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m0 = now.getUTCMonth();
    const d = now.getUTCDate();
    return {
      fromUtc: new Date(Date.UTC(y, m0, d, 0, 0, 0, 0)),
      toUtc: new Date(Date.UTC(y, m0, d, 23, 59, 59, 999)),
      appliedDefault: true,
    };
  }

  return {
    fromUtc: parseSide(fromRaw, 'from'),
    toUtc: parseSide(toRaw, 'to'),
    appliedDefault: false,
  };
}

/**
 * PUBLIC_INTERFACE
 * GET /api/dashboard/users
 */
router.get('/users', async (req, res) => {
  try {
    const tenantHdr = (req.headers?.['x-organization-id'] || '').toString();
    const tenantQuery = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();

    const requestedTenant = tenantHdr || tenantQuery || authTenant || '';

    if (!requestedTenant) {
      return res.status(400).json({
        success: false,
        message: 'Missing tenant scope',
      });
    }

    const { fromUtc, toUtc } = resolveUtcDayWindowToUtcBounds(req.query?.from, req.query?.to);

    // If caller provided from/to but parsing failed, do not silently widen the query.
    if ((req.query?.from && !fromUtc) || (req.query?.to && !toUtc)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid from/to date value(s)',
      });
    }

    const db = getDb ? await getDb() : mongoose.connection.db;

    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected',
      });
    }

    // Build Mongo filter EXACTLY as requested format:
    // tenant + session_start bounds (UTC)
    const matchFilter = {
      $and: [
        {
          $or: [
            { tenant_id: requestedTenant },
            { organization_id: requestedTenant },
            { organizationId: requestedTenant },
            { tenantId: requestedTenant },
            { orgId: requestedTenant },
            { 'tenant.tenant_id': requestedTenant },
          ],
        },
        {
          session_start: {
            ...(fromUtc && { $gte: fromUtc }),
            ...(toUtc && { $lte: toUtc }),
          },
        },
      ],
    };

    // IMPORTANT INVARIANT:
    // Session counts must match Mongo validation semantics:
    //  1) $match by tenant AND session_start within UTC window
    //  2) count DISTINCT session_id values
    // Safe handling for missing session_id: treat each doc as its own logical session by
    // falling back to the document _id (so we do not collapse multiple nulls into 1).
    const pipeline = [
      { $match: matchFilter },

      {
        $project: {
          userId: { $toString: '$user_id' },
          sessionStart: '$session_start',

          // Canonical "logical session" identifier for distinct counting:
          // - use session_id when present and non-empty
          // - otherwise fallback to _id so each record still counts as one session
          sessionId: {
            $cond: [
              { $or: [{ $eq: ['$session_id', null] }, { $eq: ['$session_id', ''] }] },
              { $toString: '$_id' },
              { $toString: '$session_id' },
            ],
          },
        },
      },

      // Defensive: skip rows with missing/empty user_id after string coercion.
      { $match: { userId: { $ne: null, $ne: '' } } },

      {
        $group: {
          _id: '$userId',
          sessionIds: { $addToSet: '$sessionId' },
          lastActivityAt: { $max: '$sessionStart' },
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
        $project: {
          _id: 0,
          userId: '$_id',
          totalSessions: 1,
          lastActivityAt: 1,
        },
      },

      { $sort: { lastActivityAt: -1 } },
    ];

    const users = await db
      .collection('session_tracking')
      .aggregate(pipeline, { allowDiskUse: true })
      .toArray();

    res.set('X-Date-Window-Timezone', 'UTC');

    if (fromUtc) res.set('X-Date-Window-From-UTC', fromUtc.toISOString());
    if (toUtc) res.set('X-Date-Window-To-UTC', toUtc.toISOString());

    return res.status(200).json({
      success: true,
      from: fromUtc ? fromUtc.toISOString() : null,
      to: toUtc ? toUtc.toISOString() : null,
      users,
    });
  } catch (err) {
    console.error('[dashboard.users] error:', err);

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
});

module.exports = router;
