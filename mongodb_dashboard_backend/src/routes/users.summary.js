const express = require('express');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /api/users/summary
 * Users created summary grouped by time buckets with tenant scoping.
 *
 * Query params:
 * - range: 'daily' | 'weekly' | 'monthly' | 'custom' (default: 'daily')
 * - start_date, end_date (YYYY-MM-DD) required when range='custom'
 * Scoping:
 * - Tenant is derived from auth context (req.auth.tenantId) when available.
 * - If JWT tenant is present and a different organization_id/tenant_id is provided, return 403.
 * - When unauthenticated, allow x-organization-id header; fall back to query organization_id/tenant_id.
 * - Ignore organization_id/tenant_id from query when auth tenant exists.
 *
 * Returns 200 JSON:
 * {
 *   buckets: [{ key, label, count }],
 *   range,
 *   start_date,
 *   end_date
 * }
 */
router.get('/summary', async (req, res) => {
  try {
    // Minimal logging to confirm the route is hit and params parsed
    try { console.info('[users.summary] hit', { query: req.query }); } catch {}

    let { range = 'daily', start_date, end_date } = req.query || {};
    range = String(range || 'daily').toLowerCase();
    const ALLOWED = new Set(['daily', 'weekly', 'monthly', 'custom']);
    if (!ALLOWED.has(range)) {
      return res.status(400).json({ message: "Invalid 'range'. Use daily|weekly|monthly|custom." });
    }

    // Resolve tenant from auth context, header, or query, with conflict handling
    const authTenant =
      (req.auth && (req.auth.tenantId || req.auth.organization_id || req.auth.organizationId)) ||
      (req.user && (req.user.tenantId || req.user.organization_id || req.user.organizationId)) ||
      null;

    // Accept multiple header aliases and normalize
    const headerTenantRaw =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant']) ||
      '';
    const headerTenant = String(headerTenantRaw || '').trim();
    const queryTenant = (req.query.organization_id || req.query.tenant_id || '').toString().trim();

    let effectiveTenant = authTenant || headerTenant || queryTenant || '';

    // If auth tenant is present, ignore query/header but reject if conflicting
    if (authTenant) {
      if ((headerTenant && headerTenant !== authTenant) || (queryTenant && queryTenant !== authTenant)) {
        return res.status(403).json({ message: 'Forbidden: tenant scope mismatch' });
      }
      effectiveTenant = authTenant;
    }

    // For unauth, require some tenant (header or query)
    if (!authTenant && !effectiveTenant) {
      return res.status(400).json({ message: "Missing tenant. Provide x-organization-id header or ?organization_id=..." });
    }

    // Date helpers (UTC)
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const startOfUTCDate = (d) => new Date(`${toYMD(d)}T00:00:00.000Z`);
    const endOfUTCDate = (d) => new Date(`${toYMD(d)}T23:59:59.999Z`);
    const startOfUTCMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));

    const now = new Date();
    let windowStart;
    let windowEnd;

    if (range === 'custom') {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (!start_date || !end_date || !re.test(start_date) || !re.test(end_date)) {
        return res.status(400).json({ message: "For range=custom, 'start_date' and 'end_date' are required in YYYY-MM-DD." });
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
      windowStart = startOfUTCDate(now);
      windowEnd = endOfUTCDate(now);
    } else if (range === 'weekly') {
      // ISO week for current week (Mon..Sun)
      const today = startOfUTCDate(now);
      const dow = today.getUTCDay() || 7; // Sunday=0->7
      const monday = new Date(today);
      monday.setUTCDate(today.getUTCDate() - (dow - 1));
      windowStart = monday;
      const sundayEnd = new Date(monday);
      sundayEnd.setUTCDate(monday.getUTCDate() + 6);
      windowEnd = endOfUTCDate(sundayEnd);
    } else if (range === 'monthly') {
      const start = startOfUTCMonth(now);
      const end = endOfUTCDate(now);
      windowStart = start;
      windowEnd = end;
    }

    // Build match with tenant scoping; normalize tenant fields in users collection
    const createdAtFilter = { $gte: windowStart, $lte: windowEnd };
    const match = { created_at: createdAtFilter };
    if (effectiveTenant) {
      match.$or = [
        { tenant_id: effectiveTenant },
        { organization_id: effectiveTenant },
        { organizationId: effectiveTenant },
        { tenantId: effectiveTenant },
        { orgId: effectiveTenant },
        { 'tenant.tenant_id': effectiveTenant },
      ];
    }

    // Bucketing key (ensure _id is a STRING; use dateToString/concat)
    let groupIdExpr;
    if (range === 'daily' || range === 'custom') {
      groupIdExpr = { $dateToString: { format: '%Y-%m-%d', date: '$created_at', timezone: 'UTC' } };
    } else if (range === 'weekly') {
      groupIdExpr = {
        $concat: [
          { $toString: { $isoWeekYear: '$created_at' } },
          '-W',
          {
            $let: {
              vars: { w: { $isoWeek: '$created_at' } },
              in: {
                $cond: [{ $lt: ['$$w', 10] }, { $concat: ['0', { $toString: '$$w' }] }, { $toString: '$$w' }],
              },
            },
          },
        ],
      };
    } else if (range === 'monthly') {
      groupIdExpr = { $dateToString: { format: '%Y-%m', date: '$created_at', timezone: 'UTC' } };
    }

    // Prefer db handle on app, fallback to mongoose
    const db = req.app.get('db');
    let aggregate;
    if (db && typeof db.collection === 'function') {
      aggregate = () =>
        db
          .collection('users')
          .aggregate(
            [
              { $match: match },
              { $group: { _id: groupIdExpr, count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              { $project: { _id: 0, key: '$_id', count: 1 } },
            ],
            { allowDiskUse: true }
          )
          .toArray();
    } else {
      try {
        const User = require('../models/user.model');
        aggregate = async () =>
          await User.aggregate([
            { $match: match },
            { $group: { _id: groupIdExpr, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, key: '$_id', count: 1 } },
          ]).allowDiskUse(true);
      } catch {
        return res.status(500).json({ message: 'Internal server error: users collection unavailable' });
      }
    }

    const results = await aggregate();

    // Map to response buckets with human-friendly labels (for week/month keep same for now)
    const buckets = results.map((r) => ({
      key: r.key,
      label: r.key,
      count: Number(r.count || 0),
    }));

    // Ascending sort by key (string sort works for YYYY-MM and YYYY-MM-DD; weeks too)
    buckets.sort((a, b) => (a.key > b.key ? 1 : a.key < b.key ? -1 : 0));

    return res.status(200).json({
      buckets,
      range,
      start_date: toYMD(windowStart),
      end_date: toYMD(windowEnd),
    });
  } catch (err) {
    console.error('[users.summary] error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
