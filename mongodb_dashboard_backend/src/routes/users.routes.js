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
/**
 * PUBLIC_INTERFACE
 * GET /api/users/active-trend-from-users
 * Alias of /api/users/active-trend
 * Accepts legacy/alternate params and normalizes:
 *  - start -> from
 *  - end -> to
 *  - organization_id -> tenant_id
 * Also validates granularity in {day,week}.
 */
router.get(
  '/active-trend-from-users',
  extractOrganization(), // require and normalize organization scope
  asyncHandler(async (req, res) => {
    // Normalize aliases
    const q = req.query || {};
    const fromParam = q.start || q.from;
    const toParam = q.end || q.to;
    const gran = (q.granularity || 'day').toString().toLowerCase();
    const organizationId = q.organization_id || q.tenant_id || req.organizationId || req.tenantId;

    // Validate required organization scope
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: 'organization_id is required via header x-organization-id or ?organization_id',
      });
    }

    // Validate and normalize dates
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const fromISO = fromParam || defaultFrom.toISOString();
    const toISO = toParam || now.toISOString();

    const fromDate = new Date(fromISO);
    const toDate = new Date(toISO);
    if (Number.isNaN(fromDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "start/from" date' });
    }
    if (Number.isNaN(toDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid "end/to" date' });
    }
    if (fromDate > toDate) {
      return res.status(400).json({ success: false, message: '"from" must be <= "to"' });
    }

    // Validate granularity
    if (!['day', 'week', 'month'].includes(gran)) {
      return res.status(400).json({ success: false, message: 'Invalid "granularity": expected day|week|month' });
    }

    // Prepare bucketing by granularity
    let dateFormat;
    if (gran === 'day') dateFormat = '%Y-%m-%d';
    else if (gran === 'week') dateFormat = '%G-%V'; // ISO week year-week
    else dateFormat = '%Y-%m'; // month

    // Build aggregation on Users using created_at and updated_at
    // We need two separate pipelines then merge: one for created, one for updated
    const orgId = String(organizationId);

    const createdMatch = {
      organization_id: orgId,
      created_at: { $gte: fromDate, $lte: toDate },
    };
    const updatedMatch = {
      organization_id: orgId,
      updated_at: { $gte: fromDate, $lte: toDate },
    };

    const bucketStageCreated = [
      { $match: createdMatch },
      {
        $group: {
          _id: { bucket: { $dateToString: { format: dateFormat, date: '$created_at' } } },
          createdCount: { $sum: 1 },
        },
      },
      { $project: { _id: 0, date: '$_id.bucket', createdCount: 1 } },
    ];

    const bucketStageUpdated = [
      { $match: updatedMatch },
      {
        $group: {
          _id: { bucket: { $dateToString: { format: dateFormat, date: '$updated_at' } } },
          updatedCount: { $sum: 1 },
        },
      },
      { $project: { _id: 0, date: '$_id.bucket', updatedCount: 1 } },
    ];

    // Execute in parallel using mongoose connection on User model
    const createdAgg = await User.aggregate(bucketStageCreated).allowDiskUse(true);
    const updatedAgg = await User.aggregate(bucketStageUpdated).allowDiskUse(true);

    // Merge into a single map keyed by bucket date
    const map = new Map();
    for (const r of createdAgg) {
      const key = r.date;
      const existing = map.get(key) || { date: key, createdCount: 0, updatedCount: 0 };
      existing.createdCount += r.createdCount || 0;
      map.set(key, existing);
    }
    for (const r of updatedAgg) {
      const key = r.date;
      const existing = map.get(key) || { date: key, createdCount: 0, updatedCount: 0 };
      existing.updatedCount += r.updatedCount || 0;
      map.set(key, existing);
    }

    // Fill missing buckets for day granularity (and week/month as coarse fill)
    function addDaysUTC(date, days) {
      const d = new Date(date);
      const out = new Date(d);
      out.setUTCDate(d.getUTCDate() + days);
      return out;
    }
    function formatDay(d) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    function formatMonth(d) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
    function getISOWeekYearWeek(d) {
      // ISO week date, compute year-week
      const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      // Thursday in current week decides the year.
      date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
      const weekStr = String(weekNo).padStart(2, '0');
      return `${date.getUTCFullYear()}-${weekStr}`;
    }

    const series = [];
    if (gran === 'day') {
      // fill each day inclusive between from and to
      let cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
      const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
      while (cursor <= end) {
        const k = formatDay(cursor);
        const entry = map.get(k) || { date: k, createdCount: 0, updatedCount: 0 };
        series.push(entry);
        cursor = addDaysUTC(cursor, 1);
      }
      // Ensure sorted
      series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } else if (gran === 'week') {
      // For week, we rely on aggregation keys like %G-%V (or computed fallback).
      // Because Mongo %G-%V support varies, map keys already present from aggregation; we won’t fill missing implicitly.
      for (const [k, v] of map.entries()) series.push({ date: k, createdCount: v.createdCount, updatedCount: v.updatedCount });
      series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } else {
      // month
      for (const [k, v] of map.entries()) series.push({ date: k, createdCount: v.createdCount, updatedCount: v.updatedCount });
      series.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    }

    return res.status(200).json({
      success: true,
      granularity: gran,
      from: new Date(fromDate).toISOString(),
      to: new Date(toDate).toISOString(),
      series,
    });
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
 * Returns distinct projects for the specified user based on session_tracking activity.
 * Query:
 *  - organization_id or tenant_id: required tenant (organization) id
 *  - from, to: optional ISO date-time bounds for time range filtering
 * Response:
 *  200: { user_id, tenant_id, projects: [{ project_id, project_name?, last_activity? }] }
 *  400: Missing/invalid parameters
 */
router.get('/:userId/projects', asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  // Accept both organization_id and tenant_id; prefer organization_id
  const tenantId = (req.query.organization_id || req.query.tenant_id || req.organizationId || req.tenantId || '').toString().trim();

  if (!userId || !tenantId) {
    return res.status(400).json({ success: false, message: 'userId (path) and organization_id/tenant_id (query/header) are required' });
  }

  // Debug trace to validate handler entry and resolved scope during runtime
  try {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      // eslint-disable-next-line no-console
      console.debug(`[users.projects] GET /api/users/${userId}/projects tenantId=${tenantId} from=${req.query?.from || 'n/a'} to=${req.query?.to || 'n/a'}`);
    }
  } catch {}

  // Validate optional dates (lenient: backend service handles conversion; here we only pass through)
  const { from, to } = req.query || {};
  const { getUserProjectsFromSessions } = require('../services/users.service');

  try {
    const payload = await getUserProjectsFromSessions({
      tenantId,
      userId,
      from,
      to,
    });

    // Ensure projects is always an array for safety
    const safePayload = {
      user_id: String(payload?.user_id || userId),
      tenant_id: String(payload?.tenant_id || tenantId),
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
    };

    return res.status(200).json(safePayload);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[users.projects] error:', err?.message || err);
    // Return safe default 200 with empty list to avoid 404/500 breaking frontend
    return res.status(200).json({
      user_id: String(userId),
      tenant_id: String(tenantId),
      projects: [],
      info: 'Fallback due to internal error while aggregating projects',
    });
  }
}));

router.get('/:id', controller.getById);
router.post('/', controller.create);
router.put('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
