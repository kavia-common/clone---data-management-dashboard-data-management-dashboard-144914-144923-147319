'use strict';

/**
 * PUBLIC_INTERFACE
 * GET /api/projects/summary
 * Aggregates projects by created_at into daily buckets with strict tenant and date filters.
 * - Tenant resolution: JWT context (req.organizationId/req.tenantId) > x-organization-id header > ?organization_id|?tenant_id
 * - Date range:
 *    daily: today UTC
 *    weekly: last 7 days (inclusive)
 *    monthly: last 30 days (inclusive)
 *    custom: inclusive [start_date T00:00:00.000Z, end_date T23:59:59.999Z]
 * Adds debug headers: x-effective-tenant, x-projects-window-from, x-projects-window-to, x-projects-filter
 */
const express = require('express');
const router = express.Router();
const Project = require('../models/project.model');
const { extractOrganization } = require('../middleware/extractOrganization');

// Mount middleware for tenant extraction
router.get('/summary', extractOrganization(), async (req, res) => {
  try {
    // Params
    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Allowed: daily|weekly|monthly|custom." });
    }

    // Tenant resolution
    const headerTenant = (req.get?.('x-organization-id') || req.get?.('X-Organization-Id') || req.headers['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || '').toString().trim();
    const qTenant = (req.query?.tenant_id || '').toString().trim();
    const effectiveTenant = (req.organizationId || req.tenantId || headerTenant || qOrg || qTenant || '').toString().trim();
    const isGlobal = !!req.tenantScopeDisabled || !!req.allTenants;

    if (!isGlobal && !effectiveTenant) {
      return res.status(400).json({
        message: 'Missing tenant: provide x-organization-id header or ?organization_id / ?tenant_id. Super admin may omit.',
      });
    }

    // UTC date helpers
    const pad2 = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const startOfUTC = (d) => new Date(`${ymd(d)}T00:00:00.000Z`);
    const endOfUTC = (d) => new Date(`${ymd(d)}T23:59:59.999Z`);
    const addDays = (d, days) => {
      const out = new Date(d);
      out.setUTCDate(out.getUTCDate() + days);
      return out;
    };

    // Compute bounds
    const todayStart = startOfUTC(new Date());
    let windowStart, windowEnd;
    const reDate = /^\d{4}-\d{2}-\d{2}$/;

    if (range === 'custom') {
      if (!start_date || !end_date || !reDate.test(start_date) || !reDate.test(end_date)) {
        return res.status(400).json({ message: "For range=custom, provide start_date and end_date as YYYY-MM-DD." });
      }
      windowStart = new Date(`${start_date}T00:00:00.000Z`);
      windowEnd = new Date(`${end_date}T23:59:59.999Z`);
    } else if (range === 'daily') {
      windowStart = startOfUTC(todayStart);
      windowEnd = endOfUTC(todayStart);
    } else if (range === 'weekly') {
      windowStart = startOfUTC(addDays(todayStart, -6));
      windowEnd = endOfUTC(todayStart);
    } else if (range === 'monthly') {
      windowStart = startOfUTC(addDays(todayStart, -29));
      windowEnd = endOfUTC(todayStart);
    }

    if (isNaN(windowStart?.getTime()) || isNaN(windowEnd?.getTime())) {
      return res.status(400).json({ message: 'Invalid date window computed.' });
    }
    if (windowStart > windowEnd) {
      return res.status(400).json({ message: 'start_date must be before or equal to end_date.' });
    }

    // Strict filter on correct field types and collection
    const match = {
      created_at: { $gte: windowStart, $lte: windowEnd },
      ...(isGlobal ? {} : { tenant_id: effectiveTenant }),
    };

    // Aggregate by day from projects collection
    const pipeline = [
      { $match: match },
      { $set: { _bucketStart: { $dateTrunc: { date: '$created_at', unit: 'day', timezone: 'UTC' } } } },
      { $group: { _id: '$_bucketStart', count: { $sum: 1 } } },
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
    } catch (e) {
      console.error('[projects.summary] aggregation error:', e?.message || e);
      return res.status(500).json({ message: 'Internal server error' });
    }

    // Build response
    const response = {
      range,
      start_date: ymd(windowStart),
      end_date: ymd(windowEnd),
      buckets: Array.isArray(results) ? results : [],
    };

    // Debug headers (temporary)
    try {
      res.set('Cache-Control', 'no-store');
      if (effectiveTenant) res.set('x-effective-tenant', effectiveTenant);
      res.set('x-projects-window-from', windowStart.toISOString());
      res.set('x-projects-window-to', windowEnd.toISOString());
      res.set('x-projects-filter', JSON.stringify(match));
    } catch {}

    return res.status(200).json(response);
  } catch (err) {
    console.error('[projects.summary] fatal error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
