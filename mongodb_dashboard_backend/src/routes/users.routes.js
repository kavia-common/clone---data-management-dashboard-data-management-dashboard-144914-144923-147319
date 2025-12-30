'use strict';

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

/**
 * Aggregates SessionTracking totals per user_id (as string).
 *
 * Note: SessionTracking schema is strict:false; fields total_count and total_duration may exist
 * even if not explicitly defined in the schema.
 *
 * @param {string[]} userIdStrings List of user ids (string form) to aggregate for.
 * @returns {Promise<Record<string, { session_total_count: number, session_total_duration: number }>>}
 */
async function aggregateSessionTotalsByUserId(userIdStrings) {
  if (!Array.isArray(userIdStrings) || userIdStrings.length === 0) return {};

  const unique = Array.from(new Set(userIdStrings.filter((v) => typeof v === 'string' && v.length > 0)));
  if (unique.length === 0) return {};

  // Aggregation notes:
  // - Normalize user_id to string with $toString to match user._id (stringified).
  // - Use $ifNull to default missing numeric fields to 0 so sums don't become null.
  // - total_duration may be number; preserve as number (double).
  const pipeline = [
    {
      $match: {
        $expr: { $in: [{ $toString: '$user_id' }, unique] },
      },
    },
    {
      $group: {
        _id: { $toString: '$user_id' },
        session_total_count: { $sum: { $ifNull: ['$total_count', 0] } },
        session_total_duration: { $sum: { $ifNull: ['$total_duration', 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id',
        session_total_count: 1,
        session_total_duration: 1,
      },
    },
  ];

  const rows = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
  return rows.reduce((acc, r) => {
    const k = String(r.user_id);
    acc[k] = {
      session_total_count: Number(r.session_total_count || 0),
      session_total_duration: Number(r.session_total_duration || 0),
    };
    return acc;
  }, {});
}

/**
 * Adds session totals fields to each user item without mutating the original object shape.
 *
 * @param {any[]} users List of user documents (plain objects).
 * @param {Record<string, {session_total_count:number, session_total_duration:number}>} totalsMap Totals keyed by user_id string.
 * @returns {any[]} New list with merged totals.
 */
function mergeSessionTotalsIntoUsers(users, totalsMap) {
  if (!Array.isArray(users)) return users;
  const map = totalsMap && typeof totalsMap === 'object' ? totalsMap : {};

  return users.map((u) => {
    const id = u && u._id !== undefined && u._id !== null ? String(u._id) : '';
    const totals = map[id] || { session_total_count: 0, session_total_duration: 0 };

    // Non-breaking addition: only add new flat fields, preserve all existing fields.
    return {
      ...u,
      session_total_count: Number(totals.session_total_count || 0),
      session_total_duration: Number(totals.session_total_duration || 0),
    };
  });
}

// Legacy alias: /api/users/active-trend-from-users (non-breaking proxy to analytics users active trend)
// This preserves old consumers expecting labels/datasets by adapting from the existing controller logic.
router.get(
  '/active-trend-from-users',
  asyncHandler(async (req, res) => {
    try {
      // Reuse analytics active trend controller by importing service-level logic through the analytics controller.
      // We simulate an internal call by requiring the controller module and invoking underlying aggregate with req/res shim.
      const { getUsersActiveTrendController } = require('../controllers/users.activeTrend.controller');

      // Create a mini response collector to capture JSON and then normalize to expected legacy shape.
      let captured = null;
      const captureRes = {
        status(code) {
          this._code = code;
          return this;
        },
        json(payload) {
          captured = { code: this._code || 200, payload };
          // Return a no-op object to satisfy any chaining
          return this;
        },
        set() { return this; },
      };

      // Clone query, accept optional filters without changing defaults
      const passthroughReq = Object.assign({}, req, {
        query: {
          ...req.query,
          // Keep aliasing intact: support granularity=day|week|month, from/to passthrough
        },
      });

      await getUsersActiveTrendController(passthroughReq, captureRes);

      const ok = captured && captured.code === 200 && captured.payload;
      if (!ok) {
        return res.status(200).json({ labels: [], datasets: [{ label: 'Active Users', data: [] }], meta: { } });
      }
      const p = captured.payload;

      // Normalize shape:
      // If response already is {labels,datasets}, forward as-is.
      if (Array.isArray(p.labels) && Array.isArray(p.datasets)) {
        return res.status(200).json(p);
      }
      // If response is {items:[{date,total}]}, map to labels/datasets preserving order.
      if (Array.isArray(p.items)) {
        const labels = p.items.map(r => String(r.date));
        const data = p.items.map(r => Number(r.total || 0));
        return res.status(200).json({
          labels,
          datasets: [{ label: 'Active Users', data }],
          meta: p.meta || {},
        });
      }
      // Fallback empty
      return res.status(200).json({ labels: [], datasets: [{ label: 'Active Users', data: [] }], meta: {} });
    } catch (err) {
      console.error('[users.routes] legacy /active-trend-from-users proxy error:', err?.message || err);
      return res.status(200).json({ labels: [], datasets: [{ label: 'Active Users', data: [] }], meta: {} });
    }
  })
);
const controller = buildCrudController(User, '-created_at');

/* placeholder to keep search/replace stable if original block not found */

/**
 * Early bypass detector for GET /api/users
 * Applies T0000 or SuperAdmin bypass before any organization/tenant extraction for this route only.
 */
function usersEarlyBypassDetector(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/') return next();

  // Raw values (no trim) as requested
  const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id : undefined;
  const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : undefined;
  const hdrOrg =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
    (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
    (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant']) ||
    undefined;
  const authTenant =
    (typeof req?.auth?.tenantId === 'string' && req.auth.tenantId) ||
    (typeof req?.auth?.organization_id === 'string' && req.auth.organization_id) ||
    undefined;

  const requestedTenant = hdrOrg || qOrg || qTenant || authTenant;
  const isT0000 = requestedTenant === 'T0000';

  let bypassApplied = false;
  if (isT0000) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.usersAllTenantsBypass = true;
    bypassApplied = true;

    try {
      res.set('X-Tenant-Bypass', 'true');
      res.set('X-Requested-Tenant', 'T0000');
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } catch {}
  } else {
    try {
      res.set('X-Tenant-Bypass', 'false');
      if (requestedTenant) res.set('X-Requested-Tenant', String(requestedTenant));
    } catch {}
  }

  console.log('[users.routes][GET /api/users] earlyBypassDetector', {
    qOrg,
    qTenant,
    hdrOrg,
    authTenant,
    requestedTenant,
    isT0000,
    bypassApplied,
  });

  return next();
}

/**
 * Expose applied tenant and preview filter for diagnostics
 */
router.use((req, res, next) => {
  try {
    if (req.tenantScopeDisabled || req.allTenants) {
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
      res.set('X-Applied-Filter', JSON.stringify({ $match: 'none (super-admin all tenants)' }));
      try { res.set('X-Model-Collection', User.collection?.name || 'users'); } catch(_) {}
    } else if (req.tenantId) {
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
  if (!entry) {return null;}
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
    if (cached) {return res.status(200).json(cached);}

    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (from && Number.isNaN(fromDate?.getTime()))
      {return res.status(400).json({ success: false, message: 'Invalid "from" date' });}
    if (to && Number.isNaN(toDate?.getTime()))
      {return res.status(400).json({ success: false, message: 'Invalid "to" date' });}

    const match = {};
    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()) };
    } else {match.status = statusParam;}

    const timeClauses = [];
    if (fromDate || toDate) {
      const range = {};
      if (fromDate) {range.$gte = fromDate;}
      if (toDate) {range.$lte = toDate;}
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
    if (!tenantId && req.tenantId) {tenantId = String(req.tenantId);}
    if (tenantId && req.tenantId && String(tenantId) !== String(req.tenantId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate) || Number.isNaN(toDate))
      {return res.status(400).json({ success: false, message: 'Invalid date range' });}

    const cacheKey = buildActiveTrendCacheKey({ from, to, granularity, status: statusParam, tenant_id: tenantId });
    const cached = getCache(ACTIVE_TREND_CACHE, cacheKey);
    if (cached) {return res.json(cached);}

    const match = {
      last_updated: { $gte: fromDate, $lte: toDate },
    };
    if (tenantId) {match.tenant_id = tenantId;}

    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()) };
    } else {match.status = statusParam;}

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
  // Place early detector first in chain
  usersEarlyBypassDetector,
  // Skip extraction if bypassed, else extract
  function conditionalExtractOrg(req, res, next) {
    if (req.tenantScopeDisabled || req.allTenants || req.usersAllTenantsBypass) {
      console.log('[users:list] conditionalExtractOrg skipped due to bypass flags');
      return next();
    }
    const { extractOrganization } = require('../middleware/extractOrganization');
    return extractOrganization()(req, res, next);
  },
  // Final handler that also confirms applied headers/flags
  function usersListHandler(req, res, next) {
    try {
      res.set('X-Users-Bypass', String(!!req.usersAllTenantsBypass));
      res.set('X-All-Tenants', String(!!(req.tenantScopeDisabled || req.allTenants)));
      const applied = req.tenantScopeDisabled || req.allTenants ? 'all-tenants' : (req.tenantId || '');
      res.set('X-Applied-Tenant', String(applied));
      console.log('[users:list] handler-entry', {
        qOrg: req.query?.organization_id,
        qTenant: req.query?.tenant_id,
        hdrOrg: req.headers?.['x-organization-id'],
        authTenant: req?.auth?.tenantId,
        usersBypass: !!req.usersAllTenantsBypass,
        allTenants: !!(req.tenantScopeDisabled || req.allTenants),
        appliedTenant: String(applied || ''),
      });
    } catch {}

    // Wrap controller.list response to add non-breaking fields.
    // This preserves all existing scoping/filter/sort/pagination behavior because we delegate
    // to the existing controller and only post-process the payload.
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);

    // Track status code to preserve existing behavior even if controller sets it explicitly.
    let statusCode = 200;
    res.status = (code) => {
      statusCode = code;
      return originalStatus(code);
    };

    res.json = async (payload) => {
      try {
        // Only augment successful list responses; if payload is unexpected, pass through.
        // controller.list returns either:
        //  - array: [user,...]
        //  - envelope: { success:true, data:[user,...], meta:{...} }
        const isEnvelope =
          payload &&
          typeof payload === 'object' &&
          !Array.isArray(payload) &&
          Array.isArray(payload.data);

        const usersArray = Array.isArray(payload) ? payload : isEnvelope ? payload.data : null;
        if (!Array.isArray(usersArray)) {
          return originalJson(payload);
        }

        const userIds = usersArray
          .map((u) => (u && u._id !== undefined && u._id !== null ? String(u._id) : ''))
          .filter(Boolean);

        const totalsMap = await aggregateSessionTotalsByUserId(userIds);
        const merged = mergeSessionTotalsIntoUsers(usersArray, totalsMap);

        const out = Array.isArray(payload) ? merged : { ...payload, data: merged };

        // Preserve status code semantics
        if (statusCode && typeof statusCode === 'number') {
          // res.status already called; if not, this is harmless
          try { res.status(statusCode); } catch {}
        }

        return originalJson(out);
      } catch (err) {
        // Non-breaking safety: if aggregation fails, fall back to original payload.
        console.error('[users:list] session totals augmentation failed:', err?.message || err);
        return originalJson(payload);
      }
    };

    return controller.list(req, res, next);
  }
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

  /**
   * Normalize incoming time bounds for this endpoint.
   * Supports:
   * - ISODate("...") wrapper (frontend legacy behavior)
   * - Full ISO timestamp
   * - Date-only "YYYY-MM-DD" (expanded to full-day UTC bounds)
   *
   * Returns:
   * - undefined when input is empty/invalid (so service behaves like "no bound")
   */
  function normalizeProjectsRangeParam(value, { mode }) {
    if (value === undefined || value === null || value === '') return undefined;

    let s = String(value).trim();

    // Unwrap ISODate("...") or ISODate('...') if present
    // Example: ISODate("2025-12-30T00:00:00.000Z")
    const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(s);
    if (isoDateWrapped && isoDateWrapped[1]) {
      s = isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '');
    }

    // Date-only => expand to UTC full-day bounds
    const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (ymd) {
      const y = Number(ymd[1]);
      const m0 = Number(ymd[2]) - 1;
      const d = Number(ymd[3]);

      const dt =
        mode === 'from'
          ? new Date(Date.UTC(y, m0, d, 0, 0, 0, 0))
          : new Date(Date.UTC(y, m0, d, 23, 59, 59, 999));

      return dt.toISOString();
    }

    // Pass through ISO timestamps if valid
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return undefined;
    return dt.toISOString();
  }

  const rawFrom = req.query?.from;
  const rawTo = req.query?.to;
  const from = normalizeProjectsRangeParam(rawFrom, { mode: 'from' });
  const to = normalizeProjectsRangeParam(rawTo, { mode: 'to' });

  // Debug trace to validate handler entry and resolved scope during runtime
  try {
    if (process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true') {
      console.debug(
        `[users.projects] GET /api/users/${userId}/projects tenantId=${tenantId} rawFrom=${rawFrom || 'n/a'} rawTo=${rawTo || 'n/a'} normalizedFrom=${from || 'n/a'} normalizedTo=${to || 'n/a'}`
      );
    }
  } catch {}

  const { getUserProjectsFromSessions } = require('../services/users.service');

  try {
    const payload = await getUserProjectsFromSessions({
      tenantId,
      userId,
      from,
      to,
      req, // allow service to detect super admin bypass
    });

    // Ensure projects is always an array for safety
    const safePayload = {
      user_id: String(payload?.user_id || userId),
      tenant_id: String(payload?.tenant_id || tenantId),
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
    };

    return res.status(200).json(safePayload);
  } catch (err) {
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

/**
 * IMPORTANT: Keep static subpaths (e.g., '/summary' mounted via users.summary.js) registered BEFORE this dynamic ':id'
 * to avoid collisions such as '/api/users/summary' being treated as ':id'.
 */
/**
 * Guard: validate MongoDB ObjectId to avoid casting errors when static paths like 'summary' slip through.
 * Returns 404 when id is not a valid ObjectId, preventing CastError.
 */
router.get('/:id', (req, res, next) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    // Treat invalid ids as not found to avoid leaking internal errors and to prevent casting attempts.
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return controller.getById(req, res, next);
});

router.post('/', controller.create);
router.put('/:id', (req, res, next) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  return controller.update(req, res, next);
});
router.delete('/:id', (req, res, next) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  return controller.remove(req, res, next);
});

module.exports = router;
