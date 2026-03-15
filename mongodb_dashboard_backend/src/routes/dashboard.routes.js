'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireTenant } = require('../middleware/requireTenant');
const { getDb } = require('../config/db');
const { attachAuthContext } = require('../middleware/auth');

const router = express.Router();

router.use(attachAuthContext(), requireTenant);

/**
 * Resolve date range strictly as UTC calendar days.
 *
 * INPUT
 *  from=YYYY-MM-DD
 *  to=YYYY-MM-DD
 *
 * OUTPUT
 *  session_start: {
 *     $gte: ISODate("YYYY-MM-DDT00:00:00.000Z"),
 *     $lte: ISODate("YYYY-MM-DDT23:59:59.999Z")
 *  }
 */

function resolveUtcDayWindowToUtcBounds(fromRaw, toRaw) {

  const parseYmd = (s) => {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!m) return null;

    return {
      y: Number(m[1]),
      m0: Number(m[2]) - 1,
      d: Number(m[3])
    };
  };

  const fromYmd = parseYmd(fromRaw);
  const toYmd = parseYmd(toRaw);

  // Default = today UTC
  if (!fromYmd && !toYmd) {

    const now = new Date();
    const y = now.getUTCFullYear();
    const m0 = now.getUTCMonth();
    const d = now.getUTCDate();

    return {
      fromUtc: new Date(Date.UTC(y, m0, d, 0, 0, 0, 0)),
      toUtc: new Date(Date.UTC(y, m0, d, 23, 59, 59, 999)),
      appliedDefault: true
    };
  }

  const fromUtc = fromYmd
    ? new Date(Date.UTC(fromYmd.y, fromYmd.m0, fromYmd.d, 0, 0, 0, 0))
    : null;

  const toUtc = toYmd
    ? new Date(Date.UTC(toYmd.y, toYmd.m0, toYmd.d, 23, 59, 59, 999))
    : null;

  return {
    fromUtc,
    toUtc,
    appliedDefault: false
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
        message: 'Missing tenant scope'
      });
    }

    const { fromUtc, toUtc } =
      resolveUtcDayWindowToUtcBounds(req.query?.from, req.query?.to);

    const db = getDb ? await getDb() : mongoose.connection.db;

    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database not connected'
      });
    }

    // Build Mongo filter EXACTLY as requested format
    const matchFilter = {
      $and: [
        {
          $or: [
            { tenant_id: requestedTenant },
            { organization_id: requestedTenant },
            { organizationId: requestedTenant },
            { tenantId: requestedTenant },
            { orgId: requestedTenant },
            { 'tenant.tenant_id': requestedTenant }
          ]
        },
        {
          session_start: {
            ...(fromUtc && { $gte: fromUtc }),
            ...(toUtc && { $lte: toUtc })
          }
        }
      ]
    };

    const pipeline = [

      { $match: matchFilter },

      {
        $project: {
          userId: { $toString: '$user_id' },
          sessionStart: '$session_start'
        }
      },

      {
        $group: {
          _id: '$userId',
          totalSessions: { $sum: 1 },
          lastActivityAt: { $max: '$sessionStart' }
        }
      },

      {
        $project: {
          _id: 0,
          userId: '$_id',
          totalSessions: 1,
          lastActivityAt: 1
        }
      },

      { $sort: { lastActivityAt: -1 } }

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
      users
    });

  } catch (err) {

    console.error('[dashboard.users] error:', err);

    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });

  }

});

module.exports = router;