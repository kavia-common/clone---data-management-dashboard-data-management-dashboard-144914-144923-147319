const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');

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
  asyncHandler(async (req, res, next) => {
    // We want to preserve existing behavior from controller.list:
    // - If explicit pagination (page/limit) is provided, it returns an envelope
    // - Otherwise returns a raw array.
    // We'll call it first. If result is empty (raw array or envelope with empty data),
    // we will trigger seeding via the local route handler and then re-fetch using controller.list.
    // Note: We are not using HTTP to call our own endpoint to avoid network and CORS; we directly run the same logic.

    // Helper to detect empty response body
    function isEmptyResult(body) {
      if (Array.isArray(body)) return body.length === 0;
      if (body && typeof body === 'object' && Array.isArray(body.data)) {
        return body.data.length === 0;
      }
      return false;
    }

    // Capture original res.json to intercept controller output
    const originalJson = res.json.bind(res);
    let firstPayload = undefined;

    // Temporarily override res.json to capture controller.list output
    res.json = (payload) => {
      firstPayload = payload;
      return originalJson(payload);
    };

    // First call: execute the normal listing logic
    await controller.list(req, res);

    // If not empty, we are done
    if (!isEmptyResult(firstPayload)) {
      return;
    }

    // If empty, run the same logic as /seed-if-empty, then re-run the list to return actual data
    try {
      // Run seeding (inline logic reproduced from seed-if-empty handler)
      const before = await User.countDocuments({});
      if (before === 0) {
        const now = new Date();
        const demoUsers = [
          {
            referral_code: 'REF-ALPHA',
            referral_stats: {
              total_referrals: 2,
              verified_referrals: 1,
              last_referral_date: now,
            },
            referral_history: [
              {
                user_id: 'u-101',
                user_email: 'alpha1@example.com',
                user_name: 'Alpha One',
                referred_at: now,
                status: 'verified',
              },
              {
                user_id: 'u-102',
                user_email: 'alpha2@example.com',
                user_name: 'Alpha Two',
                referred_at: now,
                status: 'pending',
              },
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

      // Re-run list: restore res.json override to capture new payload and send it
      // We need to call controller.list again and allow it to respond normally.
      return controller.list(req, res);
    } catch (err) {
      // If seeding fails for any reason, fallback to the originally empty payload already sent.
      // But since we already sent the original payload, we cannot send again.
      // Log error and end.
      // eslint-disable-next-line no-console
      console.error('Auto-seed on empty /api/users failed:', err?.message || err);
      return;
    }
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

module.exports = router;
