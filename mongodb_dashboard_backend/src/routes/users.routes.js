'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const { requireTenant } = require('../middleware/requireTenant');
const { extractOrganization } = require('../middleware/extractOrganization');
const SessionTracking = require('../models/sessionTracking.model');
const Tenant = require('../models/tenant.model');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

/**
 * Expose applied tenant and preview filter for diagnostics
 */
router.use((req, res, next) => {
  try {
    if (req.tenantId) {
      res.set('X-Applied-Tenant', String(req.tenantId));
      res.set('x-applied-organization-id', String(req.tenantId));
      const tenant = String(req.tenantId);
      const orgFilter = {
        $or: [
          { tenant_id: tenant },
          { organization_id: tenant },
          { orgId: tenant },
          { tenantId: tenant },
          { organizationId: tenant },
          { 'tenant.tenant_id': tenant },
        ],
      };
      res.set('X-Applied-Filter', JSON.stringify(orgFilter));
      try {
        // also surface model collection for this router
        res.set('X-Model-Collection', User.collection?.name || 'users');
      } catch (_) {}
    }
  } catch (_) {}
  next();
});

// ====== CACHE UTILITIES ======
const TENANT_SUMMARY_CACHE = new Map();
const TENANT_SUMMARY_TTL_MS = 5 * 60 * 1000;
const ACTIVE_TREND_CACHE = new Map();
const ACTIVE_TREND_TTL_MS = 5 * 60 * 1000;

const buildTenantSummaryCacheKey = (q) =>
  `tenant-summary:${JSON.stringify({
    from: q.from || null,
    to: q.to || null,
    status: q.status || 'completed|active',
    includeInactive: String(q.includeInactive || 'false') === 'true',
  })}`;

const buildActiveTrendCacheKey = (q) =>
  `active-trend:${JSON.stringify({
    from: q.from || null,
    to: q.to || null,
    granularity: q.granularity || 'day',
    status: q.status || 'completed|active',
    tenant_id: q.tenant_id || null,
  })}`;

function getCache(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}
function setCache(map, key, value, ttl) {
  map.set(key, { value, expiresAt: Date.now() + ttl });
}

// ====== SEED IF EMPTY ======
router.get(
  '/seed-if-empty',
  asyncHandler(async (req, res) => {
    const before = await User.countDocuments({});
    if (before > 0) {
      return res.json({ success: true, message: 'Users already exist', count: before });
    }

    const now = new Date();
    const org = req.organizationId || 'demo-org';
    const demoUsers = [
      {
        tenant_id: org,
        organization_id: org,
        referral_code: 'REF-ALPHA',
        referral_stats: { total_referrals: 2, verified_referrals: 1, last_referral_date: now },
        created_at: now,
        updated_at: now,
      },
      {
        tenant_id: org,
        organization_id: org,
        referral_code: 'REF-BETA',
        referral_stats: { total_referrals: 1, verified_referrals: 0, last_referral_date: now },
        created_at: now,
        updated_at: now,
      },
    ];
    const inserted = await User.insertMany(demoUsers);
    const after = await User.countDocuments({});
    return res.status(200).json({ success: true, inserted: inserted.length, total: after });
  })
);

// ====== TENANT SUMMARY ======
router.get(
  '/tenant-summary',
  // Ensure normalized organization scope for summary aggregation
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query || {};
    const includeInactive = String(req.query.includeInactive || 'false') === 'true';
    const statusParam = (req.query.status || 'completed|active').trim();

    const cacheKey = buildTenantSummaryCacheKey({ from, to, status: statusParam, includeInactive });
    const cached = getCache(TENANT_SUMMARY_CACHE, cacheKey);
    if (cached) return res.status(200).json(cached);

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    if (to && Number.isNaN(toDate?.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });

    const match = {};
    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()) };
    } else match.status = statusParam;

    const timeClauses = [];
    if (fromDate || toDate) {
      const range = {};
      if (fromDate) range.$gte = fromDate;
      if (toDate) range.$lte = toDate;
      timeClauses.push({ timestamp: range }, { session_start: range }, { last_updated: range });
    }

    const orgMatch = { tenant_id: req.organizationId };
    const matchStage =
      timeClauses.length > 0
        ? { $match: { ...match, ...orgMatch, $or: timeClauses } }
        : { $match: { ...match, ...orgMatch } };

    const pipeline = [
      matchStage,
      {
        $group: {
          _id: { tenant_id: '$tenant_id', user_id: { $toString: '$user_id' } },
          last_activity: { $max: '$last_updated' },
        },
      },
      {
        $group: {
          _id: '$_id.tenant_id',
          user_count: { $sum: 1 },
          last_activity: { $max: '$last_activity' },
        },
      },
      { $project: { tenant_id: '$_id', user_count: 1, last_activity: 1, _id: 0 } },
      { $sort: { user_count: -1 } },
    ];

    let items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
    const tenantIds = items.map((i) => i.tenant_id);
    const tenants = await Tenant.find({ tenant_id: { $in: tenantIds } }, { tenant_id: 1, tenant_name: 1 }).lean();

    const tenantMap = tenants.reduce((acc, t) => {
      acc[t.tenant_id] = t.tenant_name || null;
      return acc;
    }, {});

    items = items.map((i) => ({
      ...i,
      tenant_name: tenantMap[i.tenant_id] || null,
      last_activity: i.last_activity ? new Date(i.last_activity).toISOString() : null,
    }));

    const response = { items, total: items.length };
    setCache(TENANT_SUMMARY_CACHE, cacheKey, response, TENANT_SUMMARY_TTL_MS);
    res.status(200).json(response);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/users/active-trend
 * Returns trend of distinct active users bucketed by day/week.
 * Scoping:
 *  - If query.tenant_id is provided, it must match the authenticated/org tenant.
 *  - If not provided, enforce req.tenantId from middleware.
 * Notes:
 *  - verifyAuth + requireTenant are mounted at router level in routes/index.js.
 */
router.get(
  '/active-trend',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const from = req.query.from || defaultFrom.toISOString();
    const to = req.query.to || now.toISOString();
    const granularity = (req.query.granularity || 'day').toLowerCase();
    const statusParam = (req.query.status || 'completed|active').trim();
    // Enforce tenant scoping:
    // - If query.tenant_id present, use it only if it matches req.tenantId
    // - Otherwise, default to req.tenantId
    let tenantId = req.query.tenant_id ? String(req.query.tenant_id) : null;
    if (!tenantId && req.tenantId) tenantId = String(req.tenantId);
    if (tenantId && req.tenantId && String(tenantId) !== String(req.tenantId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate) || Number.isNaN(toDate))
      return res.status(400).json({ success: false, message: 'Invalid date range' });

    const cacheKey = buildActiveTrendCacheKey({ from, to, granularity, status: statusParam, tenant_id: tenantId });
    const cached = getCache(ACTIVE_TREND_CACHE, cacheKey);
    if (cached) return res.json(cached);

    const match = {
      last_updated: { $gte: fromDate, $lte: toDate },
    };
    if (tenantId) match.tenant_id = tenantId;

    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()) };
    } else match.status = statusParam;

    const dateFormat = granularity === 'week' ? '%Y-%U' : '%Y-%m-%d';
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            bucket: {
              $dateToString: { format: dateFormat, date: { $ifNull: ['$last_updated', '$session_start'] } },
            },
            user_id: { $toString: '$user_id' },
          },
        },
      },
      {
        $group: {
          _id: '$_id.bucket',
          total: { $sum: 1 },
        },
      },
      { $project: { date: '$_id', total: 1, _id: 0 } },
      { $sort: { date: 1 } },
    ];

    const items = await SessionTracking.aggregate(pipeline);
    const response = { items, meta: { from, to, granularity } };
    setCache(ACTIVE_TREND_CACHE, cacheKey, response, ACTIVE_TREND_TTL_MS);
    res.status(200).json(response);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/users
 * Returns a list of users scoped to the effective tenant.
 * Scoping rules:
 *  - When Authorization/JWT is present, the tenant is taken from req.auth.tenantId and cannot be overridden.
 *  - If ?organization_id/tenant_id or headers specify a different tenant than JWT, request is rejected with 403.
 *  - When no JWT is present (demo mode only), allow tenant from header/query and still enforce filtering.
 *  - Mongo filter uses normalized OR across {tenant_id, organization_id, orgId, tenantId, organizationId, tenant.tenant_id}.
 * - Supports optional pagination (page, limit) for envelope response; without pagination returns a raw array.
 */
router.get(
  '/',
  // Normalize org/tenant, allowing non-JWT demo mode via header/query; JWT will still be used by requireTenant at mount
  extractOrganization(),
  controller.list
);
/**
 * PUBLIC_INTERFACE
 * GET /api/users/:userId/projects
 * Returns distinct projects for a user within the scoped tenant using session_tracking collection.
 * - Requires tenant scope (JWT tenant or x-organization-id header / ?tenant_id / ?organization_id)
 * - Optional query params: from, to (ISO date-time), page, limit
 * - Pagination: when page/limit provided, wraps response with { success, data, meta }
 *
 * Diagnostics headers:
 *   - X-Endpoint: "users-user-projects"
 *   - X-User-Id: normalized string userId
 *   - X-Applied-Tenant: from requireTenant middleware
 */
/**
 * @swagger
 * /api/users/{userId}/projects:
 *   get:
 *     summary: Get projects associated with a user (from session tracking)
 *     description: >
 *       Returns distinct projects the user has activity in, based on the session_tracking collection.
 *       Requires tenant scope via JWT or x-organization-id header (or query aliases).
 *       Supports optional time range using "from" and "to" query parameters and optional pagination "page" and "limit".
 *     tags:
 *       - Users
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: User identifier (normalized to string for matching)
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         description: Tenant (organization) ID to scope the query. Alias of tenant_id; ignored when JWT is present and enforces tenant.
 *       - in: query
 *         name: tenant_id
 *         schema:
 *           type: string
 *         description: Alias for tenant (organization) ID; prefer organization_id header.
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional ISO date-time lower bound
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Optional ISO date-time upper bound
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Optional page number (enables envelope response)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         description: Optional page size (enables envelope response)
 *     responses:
 *       200:
 *         description: User projects list
 *       400:
 *         description: Missing required parameters or invalid input
 */
router.get(
  '/:userId/projects',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    // Param alignment: route uses :userId; normalize to string
    const { userId } = req.params || {};
    const normalizedUserId = String(userId || '').trim();

    // Enforce tenant (requireTenant already mounted at app/index level; also use extractOrganization)
    const tenantId = req.organizationId || req.tenantId;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message:
          'Missing tenant scope: include Authorization (JWT) or header x-organization-id or query ?tenant_id / ?organization_id',
      });
    }
    if (!normalizedUserId) {
      return res.status(400).json({ success: false, message: 'userId path parameter is required' });
    }

    // Time range
    const { from, to } = req.query || {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid "from" date' });
      }
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid "to" date' });
      }
    }

    // Minimal diagnostics headers
    res.setHeader('X-Endpoint', 'users-user-projects');
    res.setHeader('X-User-Id', normalizedUserId);
    if (tenantId) {
      try {
        res.setHeader('X-Applied-Tenant', String(tenantId));
      } catch (_) {}
    }

    // Fetch projects via service
    const { getUserProjectsFromSessions } = require('../services/users.service');
    const payload = await getUserProjectsFromSessions({
      tenantId: String(tenantId),
      userId: normalizedUserId,
      from,
      to,
    });

    // Pagination support (optional)
    const page = Number(req.query.page || 0);
    const limit = Number(req.query.limit || 0);
    if (page > 0 && limit > 0) {
      const start = (page - 1) * limit;
      const end = start + limit;
      const sliced = (payload.projects || []).slice(start, end);
      return res.status(200).json({
        success: true,
        data: sliced,
        meta: { page, limit, total: (payload.projects || []).length },
        user_id: payload.user_id,
        tenant_id: payload.tenant_id,
      });
    }

    // Non-paginated response: return the full object as documented
    return res.status(200).json(payload);
  })
);

router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
