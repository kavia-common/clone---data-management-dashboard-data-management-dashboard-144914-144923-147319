'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

/**
 * Baseline Users routes only:
 * - GET /api/users (list with optional pagination/filter/sort)
 * - GET /api/users/seed-if-empty
 * - GET /api/users/:id
 * - POST /api/users
 * - PUT /api/users/:id
 * - DELETE /api/users/:id
 *
 * All User Analysis endpoints have been removed.
 */

// PUBLIC_INTERFACE
// GET /api/users/seed-if-empty
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
 * PUBLIC_INTERFACE
 * GET /api/users
 * Supports optional:
 *  - page, limit (enables envelope response with meta)
 *  - sort (e.g., -created_at)
 *  - filter (JSON string)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Determine if envelope should be returned
    const hasPage = Object.prototype.hasOwnProperty.call(req.query, 'page');
    const hasLimit = Object.prototype.hasOwnProperty.call(req.query, 'limit');
    const explicit = hasPage || hasLimit;

    // Parse pagination defensively
    const pageRaw = Number.parseInt(req.query.page, 10);
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
    const skip = (page - 1) * limit;

    // Sort parsing: allow strings only, fallback default
    const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort : '-created_at';

    // Filter parsing: ignore malformed JSON instead of throwing
    let filter = {};
    try {
      const filterRaw = req.query.filter;
      if (typeof filterRaw === 'string' && filterRaw.trim()) {
        filter = JSON.parse(filterRaw);
      } else if (filterRaw && typeof filterRaw === 'object') {
        filter = filterRaw;
      }
    } catch {
      filter = {};
    }

    // Core query with robust error mapping
    const execQuery = async () => {
      try {
        if (explicit) {
          const [items, total] = await Promise.all([
            User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
            User.countDocuments(filter),
          ]);
          return { items, total };
        } else {
          const items = await User.find(filter).sort(sort).lean();
          return { items, total: items.length };
        }
      } catch (err) {
        const message = err?.message || 'Request failed';
        // Validation errors -> 400
        if (err?.name === 'CastError' || /Cast to/i.test(message)) {
          return res.status(400).json({ success: false, message: 'Invalid value provided (list)', details: message });
        }
        // Database connectivity issues -> 503 when disconnected
        const ready = (require('mongoose').connection || {}).readyState;
        if (ready !== 1) {
          return res.status(503).json({ success: false, message: 'Service unavailable: database not connected' });
        }
        // Other unexpected errors as 500
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
      }
    };

    let result = await execQuery();
    // If execQuery already responded (on error), return early
    if (!result || result.success === false) return;

    // Optional light seeding for empty DB (non-fatal)
    if ((result.total || 0) === 0) {
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
          // re-run query to return items consistently
          result = await execQuery();
          if (!result || result.success === false) return;
        }
      } catch {
        // seeding errors ignored intentionally
      }
    }

    const { items, total } = result;
    if (explicit) {
      return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
    }
    // When not explicit, still return plain array for compatibility
    return res.status(200).json(items);
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/users/:id
 * Returns a minimal user payload with { id, name }
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const idStr = String(id);

    // Try ObjectId lookup first when valid
    if (mongoose.Types.ObjectId.isValid(idStr)) {
      const byId = await User.findById(idStr).lean();
      if (byId) {
        const name =
          byId.name ||
          byId.displayName ||
          byId.display_name ||
          byId.full_name ||
          byId.fullName ||
          byId.username ||
          byId.email ||
          byId.user_name ||
          byId?.profile?.name ||
          byId?.profile?.fullName ||
          null;
        return res.status(200).json({ id: String(byId._id), name });
      }
    }

    // Fallback flexible match
    const orFields = [
      { id: idStr },
      { user_id: idStr },
      { username: idStr },
      { email: idStr },
      { 'profile.id': idStr },
      { 'profile.user_id': idStr },
    ];
    const direct = await User.findOne({ $or: orFields }).lean();
    if (direct) {
      const name =
        direct.name ||
        direct.displayName ||
        direct.display_name ||
        direct.full_name ||
        direct.fullName ||
        direct.username ||
        direct.email ||
        direct.user_name ||
        direct?.profile?.name ||
        direct?.profile?.fullName ||
        null;
      return res.status(200).json({ id: String(direct._id), name });
    }

    return res.status(404).json({ success: false, message: 'Not found' });
  })
);

// PUBLIC_INTERFACE
// POST /api/users
router.post('/', asyncHandler(controller.create));

// PUBLIC_INTERFACE
// PUT /api/users/:id
router.put('/:id', asyncHandler(controller.update));

// PUBLIC_INTERFACE
// DELETE /api/users/:id
router.delete('/:id', asyncHandler(controller.remove));

/**
 * PUBLIC_INTERFACE
 * GET /api/users/health
 * Lightweight health to confirm /api/users base router is mounted and reachable.
 */
router.get('/health', (req, res) => {
  return res.status(200).json({ ok: true, router: 'users.routes' });
});

module.exports = router;
