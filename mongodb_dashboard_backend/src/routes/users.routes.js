const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const { getUserProjectsFromSessions } = require('../services/users.service');
const SessionTracking = require('../models/sessionTracking.model');
const Tenant = require('../models/tenant.model');
const { getReferralSources } = require('../controllers/users.analytics.controller');
const mongoose = require('mongoose');
const { extractOrganization } = require('../middleware/extractOrganization');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

// Enforce JWT + Tenant at router level
router.use(verifyAuth, requireTenant);

// Simple in-memory cache for tenant summary (5 minutes TTL)
const TENANT_SUMMARY_CACHE = new Map();
const TENANT_SUMMARY_TTL_MS = 5 * 60 * 1000;

// Simple in-memory cache for active trend (5 minutes TTL)
const ACTIVE_TREND_CACHE = new Map();
const ACTIVE_TREND_TTL_MS = 5 * 60 * 1000;

// Simple in-memory cache for most-active (5 minutes TTL)
const MOST_ACTIVE_CACHE = new Map();
const MOST_ACTIVE_TTL_MS = 5 * 60 * 1000;

function buildTenantSummaryCacheKey(q) {
  // Normalize known params
  const key = {
    from: q.from || null,
    to: q.to || null,
    status: q.status || 'completed|active',
    includeInactive: String(q.includeInactive || 'false') === 'true',
  };
  return `tenant-summary:${JSON.stringify(key)}`;
}
/**
 * Build cache key for active trend queries
 */
function buildActiveTrendCacheKey(q) {
  const key = {
    from: q.from || null,
    to: q.to || null,
    granularity: q.granularity || 'day',
    // default status: include active and completed
    status: q.status || 'completed|active',
    tenant_id: q.tenant_id || null,
  };
  return `active-trend:${JSON.stringify(key)}`;
}
function getActiveTrendCache(key) {
  const hit = ACTIVE_TREND_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    ACTIVE_TREND_CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function setActiveTrendCache(key, value) {
  ACTIVE_TREND_CACHE.set(key, { value, expiresAt: Date.now() + ACTIVE_TREND_TTL_MS });
}

/** Helpers for Most Active cache */
function buildMostActiveCacheKey(q) {
  const key = {
    range: q.range || '30d',
    granularity: q.granularity || 'daily',
    topN: Number.isFinite(q.topN) ? q.topN : 5,
    tenant_id: q.tenant_id || null,
  };
  return `most-active:${JSON.stringify(key)}`;
}
function getMostActiveCache(key) {
  const hit = MOST_ACTIVE_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    MOST_ACTIVE_CACHE.delete(key);
    return null;
  }
  return hit.value;
}
function setMostActiveCache(key, value) {
  MOST_ACTIVE_CACHE.set(key, { value, expiresAt: Date.now() + MOST_ACTIVE_TTL_MS });
}

function getCache(key) {
  const val = TENANT_SUMMARY_CACHE.get(key);
  if (!val) return null;
  if (Date.now() > val.expiresAt) {
    TENANT_SUMMARY_CACHE.delete(key);
    return null;
  }
  return val.value;
}
function setCache(key, value) {
  TENANT_SUMMARY_CACHE.set(key, { value, expiresAt: Date.now() + TENANT_SUMMARY_TTL_MS });
}

/**
 * PUBLIC_INTERFACE
 * GET /api/users/seed-if-empty
 * Seeds a minimal set of demo users into the "users" collection if it is currently empty.
 * This helps verify that GET /api/users returns real data from MongoDB.
 *
 * Response shape:
 *  {
 *    success: true,
 *    before: <number>,
 *    inserted: <number>,
 *    after: <number>,
 *    sample: <object|null>
 *  }
 */
router.get('/seed-if-empty', asyncHandler(async (req, res) => {
  const before = await User.countDocuments({});
  let inserted = 0;

  if (before === 0) {
    const now = new Date();
    const org = req?.organizationId || 'demo-org';
    const demoUsers = [
      {
        tenant_id: org,
        organization_id: org,
        organizationId: org,
        referral_code: 'REF-ALPHA',
        referral_stats: { total_referrals: 2, verified_referrals: 1, last_referral_date: now },
        referral_history: [
          { user_id: 'u-101', user_email: 'alpha1@example.com', user_name: 'Alpha One', referred_at: now, status: 'verified' },
          { user_id: 'u-102', user_email: 'alpha2@example.com', user_name: 'Alpha Two', referred_at: now, status: 'pending' },
        ],
        created_at: now,
        updated_at: now,
        tenant_id: req.auth.tenantId,
      },
      {
        tenant_id: org,
        organization_id: org,
        organizationId: org,
        referral_code: 'REF-BETA',
        referral_stats: [{ total_referrals: 1, verified_referrals: 0, last_referral_date: now }],
        referral_history: [],
        created_at: now,
        updated_at: now,
        tenant_id: req.auth.tenantId,
      },
    ];
    const result = await User.insertMany(demoUsers);
    inserted = result.length;
  }

  const after = await User.countDocuments({});
  // Return sample constrained to the current org when available
  const org = req?.organizationId;
  const sampleFilter = org
    ? { $or: [{ organization_id: org }, { tenant_id: org }, { organizationId: org }] }
    : {};
  const sample = await User.findOne(sampleFilter).sort({ _id: -1 }).lean();

  return res.status(200).json({
    success: true,
    before,
    inserted,
    after,
    sample: sample || null,
  });
}));

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Users collection endpoints
 */

/**
 * @swagger
 * /api/users/tenant-summary:
 *   get:
 *     summary: Tenant-wise users summary
 *     description: >
 *       Aggregates distinct active users per tenant primarily from the session_tracking collection.
 *       Accepts optional time range and status filters. If includeInactive=true, falls back to the
 *       users collection joined with known tenants to include tenants without recent activity.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time lower bound
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time upper bound
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Session status filter. Default "completed|active" (i.e., completed or active).
 *       - in: query
 *         name: includeInactive
 *         schema: { type: boolean, default: false }
 *         description: When true, includes tenants from tenants/users collections even if no activity is found.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *         required: true
 *         description: Organization (tenant) identifier to scope the aggregation. Also accepted via header x-organization-id.
 *     responses:
 *       200:
 *         description: Aggregated tenant user counts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tenant_id: { type: string }
 *                       tenant_name: { type: string, nullable: true }
 *                       user_count: { type: integer }
 *                 total:
 *                   type: integer
 *                   description: Number of tenant groups returned
 */
// PUBLIC_INTERFACE
router.get(
  '/tenant-summary',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { from, to } = req.query || {};
    console.debug('CHECK req', JSON.stringify(req.query));
    const includeInactive = String(req.query.includeInactive || 'false') === 'true';
    // Default status filter: "completed|active" means include either completed or active sessions.
    const statusParam = (req.query.status || 'completed|active').trim();

    // Build cache key and attempt to serve from cache
    const cacheKey = buildTenantSummaryCacheKey({ from, to, status: statusParam, includeInactive });
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    // Parse date filters
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    }
    if (to && Number.isNaN(toDate?.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    }

    // Prepare match filter over session_tracking
    const match = {};
    // Status filter handling
    if (statusParam.includes('|')) {
      const parts = statusParam.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        match.status = { $in: parts };
      }
    } else if (statusParam) {
      match.status = statusParam;
    }

    // Apply time range: we consider any of timestamp, session_start, last_updated being in range.
    const timeClauses = [];
    if (fromDate || toDate) {
      const makeRange = (field) => {
        const r = {};
        if (fromDate) r.$gte = fromDate;
        if (toDate) r.$lte = toDate;
        return { [field]: r };
      };
      timeClauses.push(makeRange('timestamp'));
      timeClauses.push(makeRange('session_start'));
      timeClauses.push(makeRange('last_updated'));
    }

    // Always scope to current organization (tenant_id)
    const orgMatch = { tenant_id: req.organizationId };

    const matchStage =
      timeClauses.length > 0
        ? { $match: { ...match, ...orgMatch, $or: timeClauses } }
        : { $match: { ...match, ...orgMatch } };

    // Aggregate distinct user count per tenant_id; compute last_activity per tenant
    const pipeline = [
      matchStage,
      {
        $group: {
          _id: {
            tenant_id: '$tenant_id',
            user_id: { $toString: '$user_id' },
          },
          tenant_last_activity: {
            $max: {
              $ifNull: [
                '$last_updated',
                { $ifNull: ['$session_end', { $ifNull: ['$timestamp', '$session_start'] }] },
              ],
            },
          },
        },
      },
      {
        $group: {
          _id: '$_id.tenant_id',
          user_count: { $sum: 1 },
          last_activity: { $max: '$tenant_last_activity' },
        },
      },
      { $project: { _id: 0, tenant_id: '$_id', user_count: 1, last_activity: 1 } },
      { $sort: { user_count: -1, tenant_id: 1 } },
    ];

    let items = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Optionally enrich with tenant_name from tenants collection
    const tenantIds = items.map((i) => i.tenant_id).filter(Boolean);
    let tenantMap = {};
    if (tenantIds.length > 0) {
      const tenants = await Tenant.find(
        { tenant_id: { $in: tenantIds } },
        { _id: 0, tenant_id: 1, tenant_name: 1 }
      ).lean();
      tenantMap = tenants.reduce((acc, t) => {
        acc[t.tenant_id] = t.tenant_name || null;
        return acc;
      }, {});
    }

    items = items.map((i) => ({
      tenant_id: i.tenant_id,
      tenant_name: Object.prototype.hasOwnProperty.call(tenantMap, i.tenant_id)
        ? tenantMap[i.tenant_id]
        : null,
      user_count: i.user_count || 0,
      last_activity: i.last_activity ? new Date(i.last_activity).toISOString() : null,
    }));

    // If includeInactive and there are tenants with no activity, include them with user_count from users collection or zero
    if (includeInactive) {
      // Fetch all tenants for union
      const allTenants = await Tenant.find({}, { _id: 0, tenant_id: 1, tenant_name: 1 }).lean();
      const existing = new Map(items.map((x) => [x.tenant_id, x]));
      for (const t of allTenants) {
        if (!existing.has(t.tenant_id)) {
          // Attempt to count distinct users via the denormalized association in Tenant.users if present,
          // otherwise fallback to 0 (we don't have a direct users<->tenant mapping collection).
          const tenantDoc = await Tenant.findOne(
            { tenant_id: t.tenant_id },
            { users: 1, tenant_id: 1 }
          ).lean();
          const fallbackCount = Array.isArray(tenantDoc?.users)
            ? new Set(tenantDoc.users.map((u) => String(u.user_id))).size
            : 0;

          existing.set(t.tenant_id, {
            tenant_id: t.tenant_id,
            tenant_name: t.tenant_name || null,
            user_count: fallbackCount,
            last_activity: null,
          });
        }
      }
      items = Array.from(existing.values()).sort((a, b) => b.user_count - a.user_count || a.tenant_id.localeCompare(b.tenant_id));
    }

    const response = { items, total: items.length };
    setCache(cacheKey, response);
    return res.status(200).json(response);
  })
);

/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: List users
 *     description: |
 *       Returns a list of users from the users collection. Supports optional text search, sorting, and pagination.
 *       - If pagination parameters (page and/or limit) are provided, the response is wrapped in an envelope with meta.
 *       - Without pagination, a raw array of user documents is returned.
 *     tags:
 *       - Users
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number to enable envelope response
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         description: Page size to enable envelope response
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive text search on common user fields (e.g., name, email)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Sort string (e.g., -created_at or email)
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         description: JSON string filter (e.g., {"referral_code":"ABC"})
 *       - in: query
 *         name: organization_id
 *         schema:
 *           type: string
 *         required: true
 *         description: Organization (tenant) identifier to scope results. Also accepted via header x-organization-id.
 *     responses:
 *       '200':
 *         description: Successful response containing users
 */
router.get(
  '/',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    // Determine pagination intent
    const explicit =
      Object.prototype.hasOwnProperty.call(req.query, 'page') ||
      Object.prototype.hasOwnProperty.call(req.query, 'limit');

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const sort = req.query.sort || '-created_at';

    // Resolve organization from trusted middleware (headers/body/query parsed in extractOrganization)
    if (!req.organizationId) {
      // Scoping is required for this endpoint. Reject when missing.
      return res.status(400).json({
        success: false,
        message: 'organization_id is required (provide via header x-organization-id or ?organization_id=...)',
      });
    }

    // Parse filter safely
    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let clientFilter = {};
    try {
      clientFilter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Strip any client-provided org hints and dangerous operators attempting to bypass scoping
    const scrubbedFilter = {};
    if (clientFilter && typeof clientFilter === 'object') {
      for (const [k, v] of Object.entries(clientFilter)) {
        if (k === 'organization_id' || k === 'tenant_id' || k === 'organizationId') continue;
        if (k === '$or' || k === '$and') continue; // prevent logical operator bypass
        scrubbedFilter[k] = v;
      }
    }

    // Build enforced org scope across alternate schema fields
    const enforcedOrgScope = req.buildOrgFilter
      ? req.buildOrgFilter(req.organizationId)
      : {
          $or: [
            { organization_id: req.organizationId },
            { tenant_id: req.organizationId },
            { organizationId: req.organizationId },
          ],
        };

    // Compose final query: AND the user filter with org scope (if user filter empty, just org scope)
    const finalFilter =
      Object.keys(scrubbedFilter).length > 0 ? { $and: [scrubbedFilter, enforcedOrgScope] } : enforcedOrgScope;

    // Debug logs to confirm applied filter
    const debugEnabled = String(req.query.debug || 'false') === 'true';
    if (debugEnabled || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      try {
        // eslint-disable-next-line no-console
        console.debug(
          '[GET /api/users] organization_id=%s finalFilter=%s sort=%s page=%s limit=%s',
          req.organizationId,
          JSON.stringify(finalFilter),
          sort,
          explicit ? page : 'n/a',
          explicit ? limit : 'n/a'
        );
      } catch {}
    }

    try {
      if (explicit) {
        const [items, total] = await Promise.all([
          User.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
          User.countDocuments(finalFilter),
        ]);
        const meta = { page, limit, total };
        if (debugEnabled) {
          meta.debug = { finalFilter, sort, skip, limit };
        }
        return res.status(200).json({ success: true, data: items, meta });
      }

      const items = await User.find(finalFilter).sort(sort).lean();
      if (debugEnabled) {
        res.setHeader('X-Debug-Final-Filter', JSON.stringify({ filter: finalFilter, sort }));
      }
      return res.status(200).json(items);
    } catch (err) {
      const message = err?.message || 'Request failed';
      if (err?.name === 'CastError' || /Cast to/.test(message)) {
        return res.status(400).json({ success: false, message: 'Invalid value provided (list)', details: message });
      }
      return res.status(400).json({ success: false, message: 'Request failed', details: message });
    }
  })
);

// Get user by id
router.get(
  '/:id',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const idStr = String(id);
    const orgFilter = {
      $or: [
        { organization_id: req.organizationId },
        { tenant_id: req.organizationId },
        { organizationId: req.organizationId },
      ],
    };

    // Helper: resolve a user document by flexible id (ObjectId or denormalized fields) WITH org scope
    async function findUserByFlexibleId(candidate) {
      // Try ObjectId lookup first when valid
      if (mongoose.Types.ObjectId.isValid(candidate)) {
        const byId = await User.findOne({ _id: candidate, ...orgFilter }).lean();
        if (byId) return byId;
      }

      // Fallback: common id fields found in heterogeneous datasets
      const orFields = [
        { id: candidate },
        { user_id: candidate },
        { username: candidate },
        { email: candidate },
        { 'profile.id': candidate },
        { 'profile.user_id': candidate },
        { 'referral_history.user_id': candidate }, // direct match when stored as string
      ];

      const direct = await User.findOne({ $and: [{ $or: orFields }, orgFilter] }).lean();
      if (direct) return direct;

      // Final fallback: match referral_history.user_id after string coercion (covers ObjectId/number)
      const agg = await User.aggregate([
        { $match: { ...orgFilter, referral_history: { $exists: true, $type: 'array', $ne: [] } } },
        {
          $addFields: {
            _rh_ids: {
              $map: {
                input: '$referral_history',
                as: 'rh',
                in: { $toString: '$$rh.user_id' },
              },
            },
          },
        },
        { $match: { _rh_ids: { $in: [String(candidate)] } } },
        { $limit: 1 },
      ]);
      if (agg && agg[0]) return agg[0];

      return null;
    }

    const doc = await findUserByFlexibleId(idStr);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const nameCandidates = [
      doc.name,
      doc.displayName,
      doc.display_name,
      doc.full_name,
      doc.fullName,
      doc.username,
      doc.email,
      doc.user_name,
      doc?.profile?.name,
      doc?.profile?.fullName,
    ].filter((v) => typeof v === 'string' && v.trim().length > 0);

    let name = nameCandidates.length > 0 ? nameCandidates[0] : null;

    if (!name && Array.isArray(doc?.referral_history)) {
      const rh = doc.referral_history.find(
        (it) => typeof it?.user_name === 'string' && it.user_name.trim()
      );
      if (rh) {
        name = rh.user_name.trim();
      }
    }

    return res.status(200).json({ id: String(doc._id), name: name || null });
  })
);

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Create user
 *     tags: [Users]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: User document payload
 *     responses:
 *       201:
 *         description: Created
 *       422:
 *         description: Validation failed
 *       400:
 *         description: Bad request
 */
router.post(
  '/',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    // Force-stamp organization identifiers on create to prevent cross-tenant writes
    const org = req.organizationId;
    req.body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    req.body.tenant_id = org;
    req.body.organization_id = org;
    req.body.organizationId = org;
    return controller.create(req, res);
  })
);

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id or payload
 *       422:
 *         description: Validation failed
 */
router.put(
  '/:id',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const org = req.organizationId;
    req.body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
    // Only set if absent to avoid clobbering intentional same-org values
    if (!req.body.tenant_id) req.body.tenant_id = org;
    if (!req.body.organization_id) req.body.organization_id = org;
    if (!req.body.organizationId) req.body.organizationId = org;
    return controller.update(req, res);
  })
);

/**
 * @swagger
 * /api/users/{id}:
 *   delete:
 *     summary: Delete user
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id
 */
router.delete(
  '/:id',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    // Enforce that deletion targets only a document within the scoped organization
    const { id } = req.params;
    const org = req.organizationId;

    // Build org scope that cannot be bypassed
    const orgScope = {
      $or: [
        { organization_id: org },
        { tenant_id: org },
        { organizationId: org },
      ],
    };

    // Attempt to delete only if matches scope; otherwise 404 to avoid leaking existence
    const doc = await User.findOneAndDelete({ _id: id, ...orgScope }).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    return res.status(200).json({ _id: id, success: true });
  })
);

/**
 * @swagger
 * /api/users/active-trend:
 *   get:
 *     summary: Active users trend (time series)
 *     description: >
 *       Returns time-bucketed counts of distinct active users based on session_tracking.
 *       Prefers `last_updated` if present; falls back to `session_start`. Supports optional tenant scope,
 *       status filter (pipe-separated), and granularity day|week. Default granularity=day and status=completed|active.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: ISO start of range (inclusive). Default is 30 days ago if not provided.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: ISO end of range (exclusive for bucketing upper bound). Default is now if not provided.
 *       - in: query
 *         name: granularity
 *         schema: { type: string, enum: [day, week], default: day }
 *         description: Bucket size for the time series.
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: Session status filter. Default "completed|active".
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *         description: Optional tenant filter to scope the trend.
 *     responses:
 *       200:
 *         description: Active users time series
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date: { type: string, description: "YYYY-MM-DD" }
 *                       total: { type: integer }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     granularity: { type: string }
 *                     from: { type: string, format: date-time }
 *                     to: { type: string, format: date-time }
 */
// PUBLIC_INTERFACE
router.get(
  '/active-trend',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const fromStr = req.query.from || defaultFrom.toISOString();
    const toStr = req.query.to || now.toISOString();
    const granularity = (req.query.granularity || 'day').toLowerCase() === 'week' ? 'week' : 'day';
    const statusParam = (req.query.status || 'completed|active').trim();
    const tenantId = req.query.tenant_id ? String(req.query.tenant_id) : null;

    // Validate dates
    const fromDate = new Date(fromStr);
    const toDate = new Date(toStr);
    if (Number.isNaN(fromDate.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "from" date' });
    if (Number.isNaN(toDate.getTime()))
      return res.status(400).json({ success: false, message: 'Invalid "to" date' });
    if (toDate <= fromDate)
      return res.status(400).json({ success: false, message: '"to" must be after "from"' });

    // Cache
    const cacheKey = buildActiveTrendCacheKey({
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      granularity,
      status: statusParam,
      tenant_id: tenantId,
    });
    const cached = getActiveTrendCache(cacheKey);
    if (cached) return res.status(200).json(cached);

    // Build match
    const match = {};
    if (tenantId) match.tenant_id = tenantId;

    if (statusParam.includes('|')) {
      const parts = statusParam.split('|').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) match.status = { $in: parts };
    } else if (statusParam) {
      match.status = statusParam;
    }

    // Build activity timestamp and bucket key based on granularity
    // activity_ts = coalesce(last_updated, session_start)
    const addFieldsStage = {
      $addFields: {
        activity_ts: {
          $ifNull: ['$last_updated', '$session_start'],
        },
      },
    };

    const dateMatchStage = {
      $match: {
        ...match,
        activity_ts: { $gte: fromDate, $lte: toDate },
      },
    };

    // Bucket expression
    const projectBucketStage = granularity === 'week'
      ? {
          $project: {
            tenant_id: 1,
            user_id_str: { $toString: '$user_id' },
            bucket: {
              $dateToString: {
                format: '%G-%V', // ISO week-year-week
                date: '$activity_ts',
                timezone: 'UTC',
              },
            },
            weekStart: {
              $dateFromParts: {
                isoWeekYear: { $isoWeekYear: '$activity_ts' },
                isoWeek: { $isoWeek: '$activity_ts' },
                isoDayOfWeek: 1,
              },
            },
          },
        }
      : {
          $project: {
            tenant_id: 1,
            user_id_str: { $toString: '$user_id' },
            bucket: {
              $dateToString: { format: '%Y-%m-%d', date: '$activity_ts', timezone: 'UTC' },
            },
          },
        };

    // Distinct users per bucket (and tenant in match if given)
    const pipeline = [
      addFieldsStage,
      dateMatchStage,
      projectBucketStage,
      {
        $group: {
          _id: { bucket: '$bucket', user_id: '$user_id_str' },
        },
      },
      {
        $group: {
          _id: '$_id.bucket',
          total: { $sum: 1 },
          weekStart: granularity === 'week' ? { $first: '$weekStart' } : undefined,
        },
      },
      { $project: { _id: 0, bucket: '$_id', total: 1, weekStart: 1 } },
      { $sort: { bucket: 1 } },
    ];

    let rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Normalize to output shape with YYYY-MM-DD date (for week use weekStart)
    const items = rows.map((r) => {
      if (granularity === 'week' && r.weekStart) {
        const d = new Date(r.weekStart);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return { date: `${yyyy}-${mm}-${dd}`, total: r.total || 0 };
      }
      // r.bucket already '%Y-%m-%d'
      return { date: String(r.bucket), total: r.total || 0 };
    });

    const response = {
      items,
      meta: {
        granularity,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
      },
    };
    setActiveTrendCache(cacheKey, response);
    return res.status(200).json(response);
  })
);

/**
 * @swagger
 * /api/users/{userId}/projects:
 *   get:
 *     summary: Get projects associated with a user (from session tracking)
 *     description: >
 *       Returns distinct projects the user has activity in, based on the session_tracking collection.
 *       Optional time range can be provided using "from" and "to" query parameters.
 *       Note: This endpoint excludes cost aggregation.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: User identifier (normalized to string for matching)
 *       - in: query
 *         name: tenant_id
 *         required: true
 *         schema: { type: string }
 *         description: Tenant (organization) ID to scope the query
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time lower bound
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time upper bound
 *     responses:
 *       200:
 *         description: User projects list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user_id: { type: string }
 *                 tenant_id: { type: string }
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       project_id: { type: string }
 *                       project_name: { type: string, nullable: true }
 *                       last_activity: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: Missing required parameters or invalid input
 */
// PUBLIC_INTERFACE
router.get(
  '/:userId/projects',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { tenant_id: tenantId, from, to } = req.query || {};

    const effectiveTenantId = req.organizationId;
    if (!tenantId) {
      // keep backwards compatible message but enforce
      // eslint-disable-next-line no-param-reassign
      req.query.tenant_id = effectiveTenantId;
    } else if (String(tenantId) !== String(effectiveTenantId)) {
      return res.status(400).json({ success: false, message: 'tenant_id mismatch with organization scope' });
    }

    // Basic ISO date validation if provided
    const parseMaybe = (v) => {
      if (!v) return undefined;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    };
    const fromIso = parseMaybe(from);
    const toIso = parseMaybe(to);

    const payload = await getUserProjectsFromSessions({
      tenantId: effectiveTenantId,
      userId,
      from: fromIso,
      to: toIso,
    });

    return res.status(200).json(payload);
  })
);

/**
 * @swagger
 * /api/users/referral-sources:
 *   get:
 *     summary: Top referral sources
 *     description: Aggregates users.referral_history by source (or infers from referral_code) and returns top N sources by count.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200, default: 10 }
 *         description: Limit number of top sources to return.
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time lower bound (applied to referred_at or created_at fallback).
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time upper bound (applied to referred_at or created_at fallback).
 *     responses:
 *       200:
 *         description: Top referral sources response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       source: { type: string }
 *                       count:  { type: integer }
 *                 totalSources:
 *                   type: integer
 */
// PUBLIC_INTERFACE
router.get(
  '/referral-sources',
  extractOrganization(),
  asyncHandler(async (req, res) => {
    if (typeof getReferralSources !== 'function') {
      return res.status(404).json({ success: false, message: 'Referral sources not implemented' });
    }
    // Attach forced filter to request for downstream handler
    req.query = { ...(req.query || {}) };
    // Strip any client-provided org fields
    delete req.query.organization_id;
    delete req.query.tenant_id;
    delete req.query.organizationId;
    // Provide enforced filter via req for controller to use
    req.enforcedOrgFilter = {
      $or: [
        { organization_id: req.organizationId },
        { tenant_id: req.organizationId },
        { organizationId: req.organizationId },
      ],
    };
    return getReferralSources(req, res);
  })
);

module.exports = router;
