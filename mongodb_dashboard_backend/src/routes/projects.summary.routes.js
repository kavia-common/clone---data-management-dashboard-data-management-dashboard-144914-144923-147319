'use strict';

// Ensure this file exports an Express.Router instance as module.exports = router;
// Mounted at app level as: app.use('/api/projects', projectsSummaryRouter)
// So the effective summary endpoint is: GET /api/projects/summary
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const SessionTracking = require('../models/sessionTracking.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Summary: Aggregates project counts grouped by activity date from session_tracking with support for daily, weekly, monthly, and custom ranges.
 * Description:
 *   - Resolves tenant from x-organization-id header or ?organization_id/?tenant_id query (aliases). Maps organization_id -> tenant_id consistently.
 *   - Uses session_tracking collection; date source prefers last_updated, then session_start, then timestamp.
 *   - Date range is inclusive: start_date 00:00:00.000Z to end_date 23:59:59.999Z (UTC).
 *   - Returns only buckets with count > 0. Sorted ascending by bucket date.
 * Parameters:
 *   - Headers: x-organization-id (optional when superadmin; otherwise required)
 *   - Query: organization_id (alias), tenant_id (alias), range, start_date, end_date
 * Responses:
 *   - 200: { range, start_date, end_date, buckets: [ { key, label, count } ] }
 *   - 400: Missing tenant (when not superadmin) or invalid parameters
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Parse input
    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({
        message: "Invalid 'range'. Allowed values: daily|weekly|monthly|custom.",
      });
    }

    // Resolve tenant from multiple sources (header and query aliases), case-insensitive
    const headerTenant =
      (typeof req.get === 'function' && (req.get('x-organization-id') || req.get('X-Organization-Id'))) ||
      req.headers['x-organization-id'] ||
      req.headers['x-org-id'] ||
      req.headers['x-tenant-id'] ||
      req.headers['x-tenant'] ||
      req.headers['organization_id'] ||
      '';
    const queryTenant =
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organizationId === 'string' && req.query.organizationId.trim()) ||
      (typeof req.query?.tenantId === 'string' && req.query.tenantId.trim()) ||
      '';
    // Prefer extractOrganization() derived values if present, otherwise header > query
    let effectiveTenant =
      req.organizationId ||
      req.tenantId ||
      headerTenant ||
      queryTenant ||
      '';

    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;

    // Diagnostics for verification
    try {
      console.log(
        `[projects.summary] tenant resolution -> org=${req.organizationId || 'n/a'} tenant=${req.tenantId || 'n/a'} header=${headerTenant || 'n/a'} query=${queryTenant || 'n/a'} effective=${effectiveTenant || 'n/a'}`
      );
    } catch {}

    if (!isGlobal && !effectiveTenant) {
      // 400 when tenant missing (non-admin)
      return res.status(400).json({
        message:
          'Missing tenant: provide x-organization-id header or ?organization_id / ?tenant_id. Super admin may omit.',
      });
    }

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };

    // Compute window
    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;
    const reDate = /^\d{4}-\d{2}-\d{2}$/;

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({
          message: "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD.",
        });
      }
      windowStart = new Date(`${start_date}T00:00:00.000Z`);
      windowEnd = new Date(`${end_date}T23:59:59.999Z`);
      if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime())) {
        return res.status(400).json({ message: 'Invalid start_date or end_date.' });
      }
      if (windowStart.getTime() > windowEnd.getTime()) {
        return res.status(400).json({ message: 'start_date must be before or equal to end_date.' });
      }
    } else if (range === 'daily') {
      windowStart = startOfUTCDate(today);
      windowEnd = endOfUTCDate(today);
    } else if (range === 'weekly') {
      windowStart = startOfUTCDate(addDays(today, -6));
      windowEnd = endOfUTCDate(today);
    } else if (range === 'monthly') {
      windowStart = startOfUTCDate(addDays(today, -29));
      windowEnd = endOfUTCDate(today);
    }

    // Build match with tenant scope on session_tracking activity date
    // Prefer last_updated, then session_start, then timestamp. We materialize a derived field 'activity_date'.
    const dateBounds = { $gte: windowStart, $lte: windowEnd };
    const tenantFilter = (!isGlobal && effectiveTenant)
      ? {
          $or: [
            { tenant_id: String(effectiveTenant) },
            { organization_id: String(effectiveTenant) },
            { organizationId: String(effectiveTenant) },
            { tenantId: String(effectiveTenant) },
            { orgId: String(effectiveTenant) },
            { 'tenant.tenant_id': String(effectiveTenant) },
          ],
        }
      : {};

    // Aggregation pipeline on session_tracking
    const pipeline = [
      // Stage 1: project a unified activity_date for correct time filtering and bucketing
      {
        $addFields: {
          activity_date: {
            $ifNull: [
              '$last_updated',
              { $ifNull: ['$session_start', '$timestamp'] },
            ],
          },
        },
      },
      // Stage 2: Date range match (inclusive)
      {
        $match: {
          activity_date: dateBounds,
          ...tenantFilter,
        },
      },
      // Stage 3: Ensure project_id exists for counting "projects"
      {
        $match: {
          project_id: { $type: 'string', $ne: '' },
        },
      },
      // Stage 4: Bucket by day using dateTrunc on activity_date
      {
        $set: { _bucketStart: { $dateTrunc: { date: '$activity_date', unit: 'day', timezone: 'UTC' } } },
      },
      // Stage 5: Group by bucket, counting distinct projects in the bucket
      {
        $group: {
          _id: '$_bucketStart',
          projects: { $addToSet: '$project_id' },
        },
      },
      // Stage 6: Transform set size to count
      {
        $project: {
          _id: 1,
          count: { $size: '$projects' },
        },
      },
      // Stage 7: Only positive counts
      { $match: { count: { $gt: 0 } } },
      // Stage 8: Sort ascending
      { $sort: { _id: 1 } },
      // Stage 9: Final shape
      {
        $project: {
          _id: 0,
          key: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          count: 1,
        },
      },
    ];

    // Prefer direct mongoose model; connection set by app
    let results = [];
    try {
      results = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
    } catch (errAgg) {
      console.error('[projects.summary] aggregation error on session_tracking:', errAgg?.message || errAgg);
      return res.status(500).json({ message: 'Internal server error' });
    }

    // Response
    const response = {
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
      buckets: results,
    };
    try {
      res.set('Cache-Control', 'no-store');
      if (effectiveTenant) res.set('x-effective-tenant', String(effectiveTenant));
      const dbg = {
        header: headerTenant || null,
        query: queryTenant || null,
        effective: effectiveTenant || null,
        range,
        start_date: toYMD(windowStart),
        end_date: toYMD(windowEnd),
        collection: 'session_tracking',
        dateField: 'activity_date(last_updated|session_start|timestamp)',
      };
      res.set('x-projects-tenant-dbg', JSON.stringify(dbg));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects.summary] fatal error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
