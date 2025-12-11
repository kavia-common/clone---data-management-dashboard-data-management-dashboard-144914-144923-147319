'use strict';

// Ensure this file exports an Express.Router instance as module.exports = router;
// Mounted at app level as: app.use('/api/projects', projectsSummaryRouter)
// Effective endpoint: GET /api/projects/summary
const express = require('express');
const router = express.Router();
const Project = require('../models/project.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Summary: Aggregates the projects collection by created_at grouped by day.
 * Description:
 *   - Resolves tenant from x-organization-id header or ?organization_id/?tenant_id query (aliases).
 *   - Uses ONLY projects.created_at for date filtering; inclusive bounds.
 *   - When range=custom, uses start_date/end_date (YYYY-MM-DD). Otherwise calculates default windows.
 *   - Filters strictly by { tenant_id: <org> } and { created_at: { $gte: start, $lte: end } }.
 * Parameters:
 *   - Headers: x-organization-id (optional for super admin; otherwise required)
 *   - Query: organization_id (alias), tenant_id (alias), range, start_date, end_date
 * Responses:
 *   - 200: { range, start_date, end_date, buckets: [ { key, label, count } ] }
 *   - 400: Invalid parameters or missing tenant (when not superadmin)
 */
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Parse inputs
    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Allowed: daily|weekly|monthly|custom." });
    }

    // Resolve tenant: prefer extractOrganization middleware; otherwise header then query
    const hdr = (typeof req.get === 'function' && (req.get('x-organization-id') || req.get('X-Organization-Id'))) || req.headers['x-organization-id'] || '';
    const qOrg = (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) || '';
    const qTenant = (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) || '';
    const effectiveTenant = req.organizationId || req.tenantId || hdr || qOrg || qTenant || '';
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({
        message: 'Missing tenant: provide x-organization-id header or ?organization_id / ?tenant_id. Super admin may omit.',
      });
    }

    // Date helpers
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };

    // Compute date window (UTC)
    const today = startOfUTCDate(new Date());
    let windowStart;
    let windowEnd;
    const reDate = /^\d{4}-\d{2}-\d{2}$/;

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({ message: "For range=custom, provide start_date and end_date as YYYY-MM-DD." });
      }
      windowStart = new Date(`${start_date}T00:00:00.000Z`);
      windowEnd = new Date(`${end_date}T23:59:59.999Z`);
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

    if (Number.isNaN(windowStart?.getTime()) || Number.isNaN(windowEnd?.getTime())) {
      return res.status(400).json({ message: 'Invalid date window computed.' });
    }
    if (windowStart.getTime() > windowEnd.getTime()) {
      return res.status(400).json({ message: 'start_date must be before or equal to end_date.' });
    }

    // Build MongoDB filter strictly as requested:
    // { created_at: { $gte: ISOStart, $lte: ISOEnd }, tenant_id: '<org>' }
    const match = {
      created_at: { $gte: windowStart, $lte: windowEnd },
      ...(isGlobal ? {} : { tenant_id: String(effectiveTenant) }),
    };

    // Aggregation on projects: bucket by day based on created_at
    const pipeline = [
      { $match: match },
      { $set: { _bucketStart: { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } } } },
      {
        $group: {
          _id: '$_bucketStart',
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          key: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          label: { $dateToString: { format: '%Y-%m-%d', date: '$_id', timezone: 'UTC' } },
          count: 1,
        },
      },
    ];

    let results = [];
    try {
      results = await Project.aggregate(pipeline).allowDiskUse(true);
    } catch (errAgg) {
      // eslint-disable-next-line no-console
      console.error('[projects.summary] aggregation error on projects:', errAgg?.message || errAgg);
      return res.status(500).json({ message: 'Internal server error' });
    }

    // Response + concise debug headers
    const response = {
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
      buckets: results,
    };

    try {
      res.set('Cache-Control', 'no-store');
      if (effectiveTenant) res.set('x-effective-tenant', String(effectiveTenant));
      res.set('x-projects-window-from', windowStart.toISOString());
      res.set('x-projects-window-to', windowEnd.toISOString());
      res.set('x-projects-filter', JSON.stringify(match));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects.summary] fatal error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
