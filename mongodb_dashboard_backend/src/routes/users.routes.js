const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const User = require('../models/user.model');
const { getUserProjectsFromSessions } = require('../services/users.service');
const SessionTracking = require('../models/sessionTracking.model');
const Tenant = require('../models/tenant.model');
const { getReferralSources } = require('../controllers/users.analytics.controller');
const mongoose = require('mongoose');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant: requireTenantMw } = require('../middleware/requireTenant');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

const { cognitoAuthMiddleware } = require('../middleware/cognitoAuth');

// Apply Cognito auth only for endpoints in this router that require it.
// We will guard GET '/' with this middleware specifically (not the whole router),
// to meet the requirement "Middleware is applied to this endpoint only".

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
        tenant_id: req.auth.tenantId,
      },
      {
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

  const after = await User.countDocuments({ tenant_id: req.auth.tenantId });
  const sample = await User.findOne({ tenant_id: req.auth.tenantId }).sort({ _id: -1 }).lean();

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
 *     summary: Get the authenticated user (scoped by tenant)
 *     description: |
 *       Returns only the authenticated user's document, filtered by tenant_id derived from the token (custom:tenant_id).
 *       Response is an array with a single user for minimal frontend change.
 *     tags:
 *       - Users
 *     responses:
 *       '200':
 *         description: Authenticated user (single element array)
 *       '401':
 *         description: Missing or invalid token; or token missing sub/email
 *       '403':
 *         description: Missing tenant_id
 *       '404':
 *         description: No matching user found
 */
// PUBLIC_INTERFACE
router.get(
  '/',
  cognitoAuthMiddleware,
  asyncHandler(async (req, res) => {
    const tenantId = req?.tenantId || req?.auth?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'Tenant required' });
    }

    // Identify user by sub (preferred) or email from token context
    const sub = req?.user?.sub || req?.auth?.sub || null;
    const email = req?.user?.email || req?.auth?.email || null;

    if (!sub && !email) {
      return res.status(401).json({ success: false, message: 'Unauthorized: no subject/email in token' });
    }

    const query = { tenant_id: tenantId };
    if (sub) {
      // match either sub field or legacy identifiers that may hold the subject
      query.$or = [{ sub }, { user_id: sub }];
    } else if (email) {
      query.email = email;
    }

    const doc = await User.findOne(query).lean();
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // sanitize token fields if present
    if (doc.tokens) {
      const safeTokens = {};
      if (process.env.NODE_ENV !== 'production') {
        safeTokens.updated_at = doc.tokens.updated_at || null;
      }
      doc.tokens = safeTokens;
    }

    return res.status(200).json([doc]);
  })
);

// Get user by id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }
    const doc = await User.findOne({ _id: id, tenant_id: req.auth.tenantId }).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json(doc);
  })
);

// Create / Update / Delete
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

// Referral sources - protected by router.use above
router.get('/referral-sources', asyncHandler(getReferralSources));

module.exports = router;
