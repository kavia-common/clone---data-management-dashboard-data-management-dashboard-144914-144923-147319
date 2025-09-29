const express = require('express');
const { success, failure, asyncHandler } = require('../utils/http');
const { hashPassword, verifyPassword, signToken } = require('../services/auth');
const User = require('../models/user.model');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints
 */

// PUBLIC_INTERFACE
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    /** Create a local user with email/password and role */
    const { email, password, role = 'user' } = req.body;
    if (!email || !password) {
      return failure(res, 'email and password are required', 400);
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return failure(res, 'User already exists', 409);
    }
    const password_hash = await hashPassword(password);
    const user = await User.create({ email, password_hash, role });
    const token = signToken({ sub: user._id.toString(), email, role });
    return success(res, { token, user: { _id: user._id, email, role } }, undefined, 201);
  })
);

// PUBLIC_INTERFACE
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    /** Authenticate a user with email/password */
    const { email, password } = req.body;
    if (!email || !password) {
      return failure(res, 'email and password are required', 400);
    }
    const user = await User.findOne({ email });
    if (!user || !user.password_hash) {
      return failure(res, 'Invalid credentials', 401);
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      return failure(res, 'Invalid credentials', 401);
    }
    const token = signToken({ sub: user._id.toString(), email, role: user.role });
    return success(res, { token, user: { _id: user._id, email, role: user.role } });
  })
);

// PUBLIC_INTERFACE
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    /** Return current authenticated user payload */
    const user = await User.findById(req.user.sub).lean();
    if (!user) return failure(res, 'User not found', 404);
    return success(res, { _id: user._id, email: user.email, role: user.role });
  })
);

module.exports = router;
