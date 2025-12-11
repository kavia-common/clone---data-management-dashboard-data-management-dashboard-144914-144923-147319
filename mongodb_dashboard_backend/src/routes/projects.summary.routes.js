'use strict';

// Ensure this file exports an Express.Router instance as module.exports = router;
// Mounted at app level as: app.use('/api/projects', projectsSummaryRouter)
// So the effective summary endpoint is: GET /api/projects/summary
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Project = require('../models/project.model');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Summary: Aggregates project counts grouped by created_at with support for daily, weekly, monthly, and custom ranges.
 * Description:
 *   - Determines organization/tenant scope from header x-organization-id (preferred) or query (?organization_id or ?tenant_id).
 *   - Super admin may access all tenants (global) when verified upstream.
 *   - Defaults: daily (today); custom requires start_date and end_date (YYYY-MM-DD).
 *   - Returns only buckets with count > 0. Sorted ascending by bucket date.
 * Parameters:
 *   - Headers: x-organization-id (optional when superadmin; otherwise required)
 *   - Query: organization_id (alias), tenant_id (alias), range, start_date, end_date
 * Responses:
 *   - 200: { range, start_date, end_date, buckets: [ { key, label, count } ] }
 *   - 400: Missing or invalid parameters (including missing organization_id when not superadmin)
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
        `[projects.summary] parsed tenant -> organizationId=${req.organizationId || 'n/a'} tenantId=${req.tenantId || 'n/a'} header=${headerTenant || 'n/a'} query=${queryTenant || 'n/a'} effective=${effectiveTenant || 'n/a'}`
      );
    } catch {}

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({
        message:
          'organization_id is required (send header x-organization-id or query ?organization_id / ?tenant_id).',
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

    // Build match with tenant scope
    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };
    if (!isGlobal && effectiveTenant) {
      effectiveTenant = String(effectiveTenant);
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },
        { organizationId: effectiveTenant },
        { tenantId: effectiveTenant },
        { orgId: effectiveTenant },
        { 'tenant.tenant_id': effectiveTenant },
      ];
    }

    // Aggregation pipeline - daily buckets via dateTrunc
    const bucketExpr = { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } };

    const pipeline = [
      { $match: match },
      { $set: { _bucketStart: bucketExpr } },
      { $group: { _id: '$_bucketStart', count: { $sum: 1 } } },
      // Only positive counts
      { $match: { count: { $gt: 0 } } },
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

    const db = req.app.get('db');

    let results = [];
    if (db && typeof db.collection === 'function') {
      results = await db.collection('projects').aggregate(pipeline, { allowDiskUse: true }).toArray();
    } else {
      results = await Project.aggregate(pipeline).allowDiskUse(true);
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
      // Diagnostics headers to verify org resolution in clients and CORS scenarios
      const dbg = {
        header: headerTenant || null,
        query: queryTenant || null,
        effective: effectiveTenant || null,
        range,
        start_date: toYMD(windowStart),
        end_date: toYMD(windowEnd),
      };
      res.set('x-projects-tenant-dbg', JSON.stringify(dbg));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[projects.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
