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

// Use Cognito/JWKS-aware auth for this router and ensure tenant presence
router.use(cognitoAuthMiddleware, (req, res, next) => {
  if (!req.tenantId && !req?.auth?.tenantId) {
    return res.status(403).json({ success: false, message: 'Tenant required' });
  }
  // Bridge values for existing code below
  req.auth = req.auth || {};
  req.auth.tenantId = req.tenantId || req.auth.tenantId;
  return next();
});

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
 *         description: JSON string filter applied server-side (e.g., {"referral_code":"ABC"})
 *     responses:
 *       '200':
 *         description: Successful response containing users
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tenantId = req?.tenantId || req?.auth?.tenantId;
    if (!tenantId) {
      return res.status(403).json({ success: false, message: 'Tenant required' });
    }

    // Identify user by sub (preferred) or email from token context
    const sub = req?.user?.sub || req?.auth?.sub || null;
    const email = req?.user?.email || req?.auth?.email || null;

    const query = { tenant_id: tenantId };
    if (sub) {
      // match either sub field or _id string in case previous records lack sub
      query.$or = [{ sub }, { _id: sub }, { user_id: sub }];
    } else if (email) {
      query.email = email;
    } else {
      return res.status(401).json({ success: false, message: 'Unauthorized: no subject/email in token' });
    }

    // Fetch a single user document
    let doc = await User.findOne(query).lean();
    // Fallback: if not found with tenant filter, try without tenant filter but then enforce/attach tenant for future
    if (!doc && email) {
      doc = await User.findOne({ email }).lean();
    }
    if (!doc) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Remove sensitive token fields from projection if any leaked via strict:false
    if (doc.tokens) {
      const safeTokens = {};
      if (process.env.NODE_ENV !== 'production') {
        // In dev you may want to return token metadata but not raw values
        safeTokens.updated_at = doc.tokens.updated_at || null;
      }
      doc.tokens = safeTokens;
    }

    return res.status(200).json([doc]); // keep array shape for minimal frontend changes
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
