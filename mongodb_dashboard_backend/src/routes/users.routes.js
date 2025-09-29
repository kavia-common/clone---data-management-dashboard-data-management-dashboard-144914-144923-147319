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
router.get('/', asyncHandler(controller.list));

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
