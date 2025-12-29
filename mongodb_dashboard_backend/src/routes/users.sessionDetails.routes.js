'use strict';

const express = require('express');
const router = express.Router();
const SessionTracking = require('../models/sessionTracking.model');
const { asyncHandler } = require('../utils/http');
const { extractOrganization } = require('../middleware/extractOrganization');

/**
 * PUBLIC_INTERFACE
 * POST /api/users/session-details
 * Summary: Returns session details for a given user scoped to a tenant.
 * Description:
 *   Accepts a JSON body { user_id: string, tenant_id?: string, from?: ISO, to?: ISO, limit?: number, page?: number, sort?: string }
 *   - user_id is required (string; normalized comparison uses $toString on user_id)
 *   - tenant_id is optional when super-admin/all-tenants bypass is active; otherwise required.
 *   - from/to are optional ISO strings to bound time (applied to last_updated, falling back to session_start/timestamp).
 *   - limit/page for pagination (defaults limit=50, page=1; max limit=200)
 *   - sort: optional sort string like "-last_updated" or "last_updated"
 *
 * Response: 200
 * {
 *   user_id: "u1",
 *   tenant_id: "org1" | null,
 *   sessions: [
 *     {
 *       _id: "mongoId",
 *       session_id: string|null,
 *       project_id: string|null,
 *       status: string|null,
 *       start_time: ISO|null,
 *       end_time: ISO|null,
 *       last_updated: ISO|null,
 *       duration_ms: number|null,
 *       model: string|null,
 *       provider: string|null,
 *       metadata: object|null
 *     }
 *   ],
 *   meta: { page, limit, total, sort }
 * }
 */
router.post(
  '/session-details',
  // Normalize tenant from headers/query when not present in body for convenience
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { user_id } = req.body || {};
    let { tenant_id, from, to, limit, page, sort } = req.body || {};

    if (!user_id || typeof user_id !== 'string') {
      return res.status(400).json({ success: false, message: 'user_id (string) is required' });
    }

    // Resolve effective tenant: prefer body.tenant_id, then req.organizationId/tenantId (from extractOrganization).
    const bypassAll = !!req.tenantScopeDisabled || !!req.allTenants;
    const effectiveTenant = tenant_id || req.organizationId || req.tenantId || null;

    if (!bypassAll && !effectiveTenant) {
      return res.status(400).json({ success: false, message: 'tenant_id is required (header x-organization-id or body.tenant_id)' });
    }

    // Pagination and sorting
    const DEFAULT_LIMIT = 50;
    const MAX_LIMIT = 200;
    const parsedLimit = Math.min(Math.max(parseInt(limit || DEFAULT_LIMIT, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const parsedPage = Math.max(parseInt(page || 1, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    // Build match filter
    const userIdString = String(user_id).trim();

    const timeClauses = [];
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid from date' });
    }
    if (to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid to date' });
    }
    if (fromDate || toDate) {
      const range = {};
      if (fromDate) range.$gte = fromDate;
      if (toDate) range.$lte = toDate;
      // Apply to multiple timestamp candidates, using $or
      timeClauses.push({ last_updated: range }, { session_start: range }, { timestamp: range });
    }

    const match = {
      ...(bypassAll ? {} : { tenant_id: effectiveTenant }),
      $expr: { $eq: [{ $toString: '$user_id' }, userIdString] },
      ...(timeClauses.length ? { $or: timeClauses } : {}),
    };

    // Sort parsing
    // Accept "-last_updated" to mean descending
    let sortStage = { last_updated: -1 };
    if (typeof sort === 'string' && sort.trim()) {
      const s = sort.trim();
      if (s.startsWith('-')) {
        sortStage = { [s.slice(1)]: -1 };
      } else {
        sortStage = { [s]: 1 };
      }
    }

    // Pipeline for paginated query
    const pipeline = [
      { $match: match },
      {
        $project: {
          // surface a consistent shape
          session_id: { $ifNull: ['$session_id', '$sessionId'] },
          project_id: { $ifNull: ['$project_id', '$projectId'] },
          status: 1,
          start_time: { $ifNull: ['$session_start', '$timestamp'] },
          end_time: {
            $cond: [
              { $and: [{ $ne: ['$status', 'active'] }, { $ne: ['$status', 'running'] }] },
              '$last_updated',
              null,
            ],
          },
          last_updated: 1,
          duration_ms: {
            $cond: [
              { $and: ['$session_start', '$last_updated'] },
              { $subtract: ['$last_updated', '$session_start'] },
              null,
            ],
          },
          model: { $ifNull: ['$model', '$session_data.model'] },
          provider: { $ifNull: ['$provider', '$session_data.provider'] },
          metadata: {
            $cond: [
              { $isArray: '$metadata' },
              null,
              { $ifNull: ['$metadata', '$session_data'] },
            ],
          },
        },
      },
      { $sort: sortStage },
      { $skip: skip },
      { $limit: parsedLimit },
    ];

    const countPipeline = [{ $match: match }, { $count: 'total' }];

    const [rows, totalAgg] = await Promise.all([
      SessionTracking.aggregate(pipeline).allowDiskUse(true),
      SessionTracking.aggregate(countPipeline).allowDiskUse(true),
    ]);

    const total = Array.isArray(totalAgg) && totalAgg.length ? Number(totalAgg[0].total) : 0;

    // Normalize ISO strings
    const sessions = (rows || []).map((r) => ({
      _id: r._id ? String(r._id) : undefined,
      session_id: r.session_id ? String(r.session_id) : null,
      project_id: r.project_id ? String(r.project_id) : null,
      status: r.status || null,
      start_time: r.start_time ? new Date(r.start_time).toISOString() : null,
      end_time: r.end_time ? new Date(r.end_time).toISOString() : null,
      last_updated: r.last_updated ? new Date(r.last_updated).toISOString() : null,
      duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : null,
      model: r.model || null,
      provider: r.provider || null,
      metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : null,
    }));

    try {
      res.set('x-user-id', userIdString);
      if (!bypassAll) res.set('x-tenant-id', String(effectiveTenant));
      res.set('x-session-details-sort', JSON.stringify(sortStage));
      res.set('x-session-details-page', String(parsedPage));
      res.set('x-session-details-limit', String(parsedLimit));
    } catch (_) {}

    return res.status(200).json({
      user_id: userIdString,
      tenant_id: bypassAll ? null : String(effectiveTenant),
      sessions,
      meta: { page: parsedPage, limit: parsedLimit, total, sort: sortStage },
    });
  })
);

module.exports = router;
