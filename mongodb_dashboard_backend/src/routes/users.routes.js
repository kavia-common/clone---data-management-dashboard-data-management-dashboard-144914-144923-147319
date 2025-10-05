const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const { getUserProjectsFromSessions } = require('../services/users.service');
const { getUserCosts, getUserProjectsCosts } = require('../services/userCosts.service');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

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

/**
 * @swagger
 * /api/users/{userId}/costs:
 *   get:
 *     summary: User cost totals and breakdowns
 *     description: >
 *       Aggregates LLM costs for a user across all projects. Returns total_cost (alias user_cost),
 *       and breakdowns computed from existing fields:
 *       - agent_name derived from agent_name | agent | metadata.agent_name
 *       - type derived from type | service_type | operation
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: User identifier (matched by string representation)
 *     responses:
 *       200:
 *         description: User cost totals and breakdown
 *       400:
 *         description: Invalid input
 */
 // PUBLIC_INTERFACE
router.get(
  '/:userId/costs',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    try {
      const payload = await getUserCosts(userId);
      return res.status(200).json(payload);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error in GET /api/users/:userId/costs', err?.message || err);
      return res.status(200).json({
        userId: String(userId),
        total_cost: 0,
        user_cost: 0,
        by_agent: [],
        by_type: [],
      });
    }
  })
);

/**
 * @swagger
 * /api/users/{userId}/projects/costs:
 *   get:
 *     summary: Per-project cost totals for a user
 *     description: Returns a list of projects with project_cost and agent totals for the specified user.
 *     tags: [Users]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *         description: User identifier (matched by string representation)
 *     responses:
 *       200:
 *         description: Project cost totals for the user
 */
 // PUBLIC_INTERFACE
router.get(
  '/:userId/projects/costs',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    try {
      const projects = await getUserProjectsCosts(userId);
      return res.status(200).json({ userId: String(userId), projects });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error in GET /api/users/:userId/projects/costs', err?.message || err);
      return res.status(200).json({ userId: String(userId), projects: [] });
    }
  })
);

module.exports = router;
