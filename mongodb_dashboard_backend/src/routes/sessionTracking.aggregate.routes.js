'use strict';

const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking
 * Aggregates session_tracking by service_type with date filters and tenant scoping.
 *
 * Query params:
 * - date_filter: daily | weekly | monthly | custom (default: daily)
 * - start_date: ISO string (required when date_filter=custom)
 * - end_date: ISO string (required when date_filter=custom)
 * - page, limit: optional; echoed back (aggregation returns all buckets)
 *
 * Tenant scoping:
 * - Resolves tenant (organization/tenant) from current request context consistent with other APIs:
 *   - Prefer req.tenantId (attached by upstream middlewares)
 *   - Accept legacy aliases from query/headers only as fallback when bypass patterns are active
 * - Super-admin/global bypass:
 *   - If the environment or middlewares set req.tenantScopeDisabled/allTenants OR requested tenant equals 'T0000',
 *     the API allows all-tenants aggregation. Otherwise, tenant is required.
 *
 * Response:
 * {
 *   items: [{ service_type: string, count: number }],
 *   total: number,
 *   date_range: { start: string, end: string },
 *   meta?: { page?: number, limit?: number }
 * }
 *
 * Example:
 * curl -s "http://localhost:4000/api/session-tracking?date_filter=weekly" -H "Authorization: Bearer <token>"
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Determine bypass status (rooted in existing patterns used in sessionTracking.routes.js)
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    // Resolve effective tenant using same precedence as existing session endpoints
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    // T0000 magic for all-tenants (matching other endpoints behavior)
    const requestedTenant = enforcedTenant;
    const isT0000 = String(requestedTenant || '').trim().toUpperCase() === 'T0000';

    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=... (or header x-organization-id / x-tenant-id).',
      });
    }

    // Parse date filters
    const now = new Date();
    let start;
    let end;

    const dateFilter = String(req.query.date_filter || 'daily').toLowerCase();
    const allowed = new Set(['daily', 'weekly', 'monthly', 'custom']);

    if (!allowed.has(dateFilter)) {
      return res.status(400).json({ success: false, message: "Invalid 'date_filter'. Allowed: daily|weekly|monthly|custom" });
    }

    function toStartOfUTC(d) {
      const dt = new Date(d);
      dt.setUTCHours(0, 0, 0, 0);
      return dt;
    }

    function toEndOfUTC(d) {
      const dt = new Date(d);
      dt.setUTCHours(23, 59, 59, 999);
      return dt;
    }

    if (dateFilter === 'custom') {
      const s = req.query.start_date;
      const e = req.query.end_date;
      if (!s || !e) {
        return res.status(400).json({ success: false, message: 'start_date and end_date are required for date_filter=custom' });
      }
      const sd = new Date(s);
      const ed = new Date(e);
      if (Number.isNaN(sd.getTime()) || Number.isNaN(ed.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start_date or end_date (expected ISO strings)' });
      }
      start = toStartOfUTC(sd);
      end = toEndOfUTC(ed);
      if (start.getTime() > end.getTime()) {
        return res.status(400).json({ success: false, message: 'start_date must be <= end_date' });
      }
    } else if (dateFilter === 'daily') {
      start = toStartOfUTC(now);
      end = toEndOfUTC(now);
    } else if (dateFilter === 'weekly') {
      const todayStart = toStartOfUTC(now);
      start = new Date(todayStart);
      start.setUTCDate(start.getUTCDate() - 6); // last 7 days incl today
      end = toEndOfUTC(now);
    } else if (dateFilter === 'monthly') {
      const todayStart = toStartOfUTC(now);
      start = new Date(todayStart);
      start.setUTCDate(start.getUTCDate() - 29); // last 30 days incl today
      end = toEndOfUTC(now);
    }

    // Build match filter
    const match = {
      session_start: { $gte: start, $lte: end },
    };

    // Apply tenant scope unless bypass or T0000
    if (!(bypass || isT0000)) {
      const t = enforcedTenant;
      match.$or = [
        { tenant_id: t },
        { organization_id: t },
        { organizationId: t },
      ];
    }

    // Read optional page/limit but aggregation returns all buckets anyway; just echo back
    const page = Number.parseInt(req.query.page, 10) || undefined;
    const limit = Number.parseInt(req.query.limit, 10) || undefined;

    try {
      // Prefer native driver when available for performance; fallback to Mongoose aggregate
      const db = req.app.get('db'); // set in app startup
      const pipeline = [
        { $match: match },
        {
          $group: {
            _id: {
              $ifNull: ['$service_type', 'unknown'],
            },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            _id: 0,
            service_type: '$_id',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ];

      let items;
      if (db && typeof db.collection === 'function') {
        items = await db.collection('session_tracking').aggregate(pipeline, { allowDiskUse: true }).toArray();
      } else {
        items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      }

      const total = items.reduce((acc, it) => acc + Number(it.count || 0), 0);

      const payload = {
        items,
        total,
        date_range: { start: start.toISOString(), end: end.toISOString() },
      };
      if (page || limit) {
        payload.meta = {};
        if (page) payload.meta.page = page;
        if (limit) payload.meta.limit = limit;
      }

      // Diagnostic headers for tenant/debug parity
      try {
        if (bypass || isT0000) {
          res.set('X-All-Tenants', 'true');
          res.set('X-Applied-Tenant', 'all-tenants');
        } else if (enforcedTenant) {
          res.set('X-Applied-Tenant', String(enforcedTenant));
        }
        res.set('X-Session-Aggregation', 'service_type');
      } catch {}

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Aggregation error', details: err?.message || '' });
    }
  })
);

module.exports = router;
