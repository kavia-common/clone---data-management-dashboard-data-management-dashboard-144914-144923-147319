const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const { getUserProjectsFromSessions } = require('../services/users.service');
const SessionTracking = require('../models/sessionTracking.model');
const Tenant = require('../models/tenant.model');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

// Simple in-memory cache for tenant summary (5 minutes TTL)
const TENANT_SUMMARY_CACHE = new Map();
const TENANT_SUMMARY_TTL_MS = 5 * 60 * 1000;

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
    const demoUsers = [
      {
        referral_code: 'REF-ALPHA',
        referral_stats: { total_referrals: 2, verified_referrals: 1, last_referral_date: now },
        referral_history: [
          { user_id: 'u-101', user_email: 'alpha1@example.com', user_name: 'Alpha One', referred_at: now, status: 'verified' },
          { user_id: 'u-102', user_email: 'alpha2@example.com', user_name: 'Alpha Two', referred_at: now, status: 'pending' },
        ],
        created_at: now,
        updated_at: now,
      },
      {
        referral_code: 'REF-BETA',
        referral_stats: [{ total_referrals: 1, verified_referrals: 0, last_referral_date: now }],
        referral_history: [],
        created_at: now,
        updated_at: now,
      },
    ];
    const result = await User.insertMany(demoUsers);
    inserted = result.length;
  }

  const after = await User.countDocuments({});
  const sample = await User.findOne({}).sort({ _id: -1 }).lean();

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
  asyncHandler(async (req, res) => {
    const { from, to } = req.query || {};
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

    const matchStage =
      timeClauses.length > 0
        ? { $match: { ...match, $or: timeClauses } }
        : { $match: match };

    // Aggregate distinct user count per tenant_id from session_tracking
    const pipeline = [
      matchStage,
      {
        $group: {
          _id: { tenant_id: '$tenant_id', user_id: { $toString: '$user_id' } },
        },
      },
      {
        $group: {
          _id: '$_id.tenant_id',
          user_count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, tenant_id: '$_id', user_count: 1 } },
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
 *     description: Retrieve a paginated list of users with optional JSON filtering and sorting.
 *     tags: [Users]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Page number (default 1)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *         description: Page size (default 20, max 200)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Sort string (e.g., -created_at)
 *       - in: query
 *         name: filter
 *         schema:
 *           type: string
 *         description: JSON string filter (e.g., {"referral_code":"ABC"})
 *     responses:
 *       200:
 *         description: List of users (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Invalid filter
 *
 * /api/users/seed-if-empty:
 *   get:
 *     summary: Seed demo users if collection is empty
 *     description: Inserts a small set of demo users only when the collection is empty, then returns counts and one sample document.
 *     tags: [Users]
 *     responses:
 *       200:
 *         description: Seeding summary and a sample document
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 before: { type: integer, example: 0 }
 *                 inserted: { type: integer, example: 2 }
 *                 after: { type: integer, example: 2 }
 *                 sample:
 *                   $ref: '#/components/schemas/GenericDocument'
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Determine pagination intent and parse filter/sort similar to controller logic
    const explicit =
      Object.prototype.hasOwnProperty.call(req.query, 'page') ||
      Object.prototype.hasOwnProperty.call(req.query, 'limit');

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
    const skip = (page - 1) * limit;

    const sort = req.query.sort || '-created_at';

    // Parse filter safely
    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let filter = {};
    try {
      filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // First pass: check data presence without sending a response
    let items = [];
    let total = 0;

    try {
      if (explicit) {
        // For pagination, we still need to detect emptiness using the paginated query
        [items, total] = await Promise.all([
          User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
          User.countDocuments(filter),
        ]);
      } else {
        items = await User.find(filter).sort(sort).lean();
        total = items.length;
      }
    } catch (err) {
      // Map common cast errors to 400 to avoid 500
      const message = err?.message || 'Request failed';
      if (err?.name === 'CastError' || /Cast to/.test(message)) {
        return res.status(400).json({ success: false, message: 'Invalid value provided (list)', details: message });
      }
      return res.status(400).json({ success: false, message: 'Request failed', details: message });
    }

    // If empty and no documents exist at all, seed and re-run once
    if (total === 0) {
      try {
        const before = await User.countDocuments({});
        if (before === 0) {
          const now = new Date();
          const demoUsers = [
            {
              referral_code: 'REF-ALPHA',
              referral_stats: { total_referrals: 2, verified_referrals: 1, last_referral_date: now },
              referral_history: [
                { user_id: 'u-101', user_email: 'alpha1@example.com', user_name: 'Alpha One', referred_at: now, status: 'verified' },
                { user_id: 'u-102', user_email: 'alpha2@example.com', user_name: 'Alpha Two', referred_at: now, status: 'pending' },
              ],
              created_at: now,
              updated_at: now,
            },
            {
              referral_code: 'REF-BETA',
              referral_stats: [{ total_referrals: 1, verified_referrals: 0, last_referral_date: now }],
              referral_history: [],
              created_at: now,
              updated_at: now,
            },
          ];
          await User.insertMany(demoUsers);
        }
        // Re-run list after seeding
        if (explicit) {
          [items, total] = await Promise.all([
            User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            User.countDocuments(filter),
          ]);
        } else {
          items = await User.find(filter).sort(sort).lean();
          total = items.length;
        }
      } catch (err) {
        // Seeding failure should not 500; return an empty array/envelope gracefully
        // and log for diagnostics
        // eslint-disable-next-line no-console
        console.error('Auto-seed on empty /api/users failed:', err?.message || err);
      }
    }

    // Final response (single send): match controller behavior and Swagger
    if (explicit) {
      return res.status(200).json({
        success: true,
        data: items,
        meta: { page, limit, total },
      });
    }
    return res.status(200).json(items);
  })
);

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Get user by ID
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: MongoDB document _id
 *     responses:
 *       200:
 *         description: User document
 *       404:
 *         description: Not found
 *       400:
 *         description: Invalid id
 */
router.get('/:id', asyncHandler(controller.getById));

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
router.post('/', asyncHandler(controller.create));

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
router.put('/:id', asyncHandler(controller.update));

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
router.delete('/:id', asyncHandler(controller.remove));

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
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { tenant_id: tenantId, from, to } = req.query || {};

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'tenant_id is required' });
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
      tenantId,
      userId,
      from: fromIso,
      to: toIso,
    });

    return res.status(200).json(payload);
  })
);

module.exports = router;
