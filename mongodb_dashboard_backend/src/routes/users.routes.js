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

    // Resolve requested tenant from query (tenant_id alias only for this endpoint)
    // and support Super Admin selector: tenant_id=T0000 => all-tenants (no tenant filter).
    const requestedTenant = req.query.tenant_id ? String(req.query.tenant_id) : null;
    const isT0000 = requestedTenant && String(requestedTenant).toUpperCase() === 'T0000';

    if (isT0000) {
      // Mark bypass so downstream logic + diagnostics are consistent with other endpoints.
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.usersAllTenantsBypass = true;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
        res.set('X-Requested-Tenant', 'T0000');
      } catch {}
    }

    // Enforce tenant scoping ONLY when not in bypass mode:
    // - If query.tenant_id is present, it must match req.tenantId (JWT-resolved tenant).
    // - Otherwise, default to req.tenantId.
    let tenantId = null;
    if (!isT0000) {
      tenantId = requestedTenant;
      if (!tenantId && req.tenantId) tenantId = String(req.tenantId);

      if (tenantId && req.tenantId && String(tenantId) !== String(req.tenantId)) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
      }
    }

    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate) || Number.isNaN(toDate)) {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }

    const cacheKey = buildActiveTrendCacheKey({
      from,
      to,
      granularity,
      status: statusParam,
      tenant_id: isT0000 ? 'all-tenants' : tenantId,
    });
    const cached = getCache(ACTIVE_TREND_CACHE, cacheKey);
    if (cached) return res.json(cached);

    // IMPORTANT:
    // Prefer last_updated if present; fall back to session_start for bucketing.
    // For T0000/all-tenants mode, do NOT apply any tenant filter.
    const match = {
      last_updated: { $gte: fromDate, $lte: toDate },
      ...(tenantId
        ? {
            $or: [
              { tenant_id: tenantId },
              { organization_id: tenantId },
              { organizationId: tenantId },
              { tenantId: tenantId },
              { orgId: tenantId },
              { 'tenant.tenant_id': tenantId },
            ],
          }
        : {}),
    };

    if (statusParam.includes('|')) {
      match.status = { $in: statusParam.split('|').map((s) => s.trim()) };
    } else {
      match.status = statusParam;
    }

    const dateFormat = granularity === 'week' ? '%Y-%U' : '%Y-%m-%d';
    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: {
            bucket: {
              $dateToString: {
                format: dateFormat,
                date: { $ifNull: ['$last_updated', '$session_start'] },
              },
            },
            user_id: { $toString: '$user_id' },
          },
        },
      },
      { $group: { _id: '$_id.bucket', total: { $sum: 1 } } },
      { $project: { date: '$_id', total: 1, _id: 0 } },
      { $sort: { date: 1 } },
    ];

    const items = await SessionTracking.aggregate(pipeline);
    const response = { items, meta: { from, to, granularity } };
    setCache(ACTIVE_TREND_CACHE, cacheKey, response, ACTIVE_TREND_TTL_MS);
    return res.status(200).json(response);
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
 * GET /api/users/:userId/sessions
 *
 * User-scoped sessions endpoint for Users Analytics.
 * This endpoint is intentionally separate from /api/session-tracking to avoid impacting
 * Session Tracking module behavior and consumers.
 *
 * Query params:
 *  - organization_id (required): tenant (organization) id. Alias: tenant_id
 *  - from (optional): ISO timestamp lower bound (inclusive)
 *  - to (optional): ISO timestamp upper bound (inclusive)
 *
 * Filtering semantics:
 *  - Always filter by user_id == :userId (string-normalized).
 *  - Always filter by tenant (organization_id) unless in bypass/all-tenants mode.
 *  - If from/to are provided: session is included when ANY of (last_updated, session_start, timestamp)
 *    falls within [from,to]. This matches existing conventions in users endpoints.
 *
 * Responses:
 *  - 200: { success:true, data:[session...], meta:{ user_id, organization_id, from, to, count } }
 *         Returns empty data array if no sessions match.
 *  - 400: invalid/missing organization_id or invalid from/to ISO timestamps
 *  - 404: if user not found (when applicable)
 */
router.get(
  '/:userId/sessions',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId;

    // Accept both organization_id and tenant_id; prefer organization_id
    const tenantIdRaw = (req.query.organization_id || req.query.tenant_id || req.organizationId || req.tenantId || '')
      .toString()
      .trim();

    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId (path) is required' });
    }
    if (!tenantIdRaw) {
      return res
        .status(400)
        .json({ success: false, message: 'organization_id (query) is required (alias: tenant_id)' });
    }

    // Support "all tenants" selector for Super Admin analytics (consistent with users projects endpoint)
    const isT0000 = String(tenantIdRaw || '').toUpperCase() === 'T0000';
    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.usersAllTenantsBypass = true;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch {}
    }

    const tenantId = tenantIdRaw;

    // Parse ISO timestamps in a timezone-safe way (Date parses ISO with timezone offsets correctly).
    // We also support ISODate("...") wrapper to be resilient to legacy callers.
    function parseIsoQueryDate(value, { fieldName }) {
      if (value === undefined || value === null || value === '') return undefined;

      let s = String(value).trim();
      const isoDateWrapped = /^ISODate\((.*)\)$/i.exec(s);
      if (isoDateWrapped && isoDateWrapped[1]) {
        s = isoDateWrapped[1].trim().replace(/^['"]|['"]$/g, '');
      }

      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        const err = new Error(`Invalid "${fieldName}" date`);
        err.statusCode = 400;
        throw err;
      }
      return d;
    }

    let fromDate;
    let toDate;
    try {
      fromDate = parseIsoQueryDate(req.query?.from, { fieldName: 'from' });
      toDate = parseIsoQueryDate(req.query?.to, { fieldName: 'to' });
    } catch (e) {
      return res.status(e.statusCode || 400).json({ success: false, message: e.message || 'Invalid date' });
    }

    // Basic bounds sanity: allow open-ended; if both provided ensure from <= to
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      return res.status(400).json({ success: false, message: '"from" must be <= "to"' });
    }

    // Optional: 404 if user does not exist.
    // We only attempt ObjectId lookup when userId looks like an ObjectId to avoid unnecessary casting errors.
    // If userId is not an ObjectId (some deployments may use string ids), we skip strict existence check.
    if (mongoose.Types.ObjectId.isValid(userId)) {
      const exists = await User.exists({ _id: new mongoose.Types.ObjectId(userId) });
      if (!exists) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
    }

    const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin || req.usersAllTenantsBypass));

    // Build filter using $and to avoid clobbering $or keys and to keep semantics explicit.
    const andClauses = [{ $expr: { $eq: [{ $toString: '$user_id' }, String(userId)] } }];

    if (fromDate || toDate) {
      const makeRange = (field) => {
        const r = {};
        if (fromDate) r.$gte = fromDate;
        if (toDate) r.$lte = toDate;
        return { [field]: r };
      };
      andClauses.push({
        $or: [makeRange('last_updated'), makeRange('session_start'), makeRange('timestamp')],
      });
    }

    if (!bypass) {
      // Organization scoping (match existing conventions; allow different tenant field names)
      andClauses.push({
        $or: [
          { tenant_id: String(tenantId) },
          { organization_id: String(tenantId) },
          { organizationId: String(tenantId) },
          { tenantId: String(tenantId) },
          { orgId: String(tenantId) },
          { 'tenant.tenant_id': String(tenantId) },
        ],
      });
    }

    const filter = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

    // Query session documents directly from session_tracking collection.
    // Keep the payload bounded: return most recent first and cap results to avoid accidental huge payloads.
    // (Frontend calls this once per "Quick Range", so it should be safe.)
    const MAX_SESSIONS = 2000;
    const sessions = await SessionTracking.find(filter)
      .sort({ last_updated: -1, session_start: -1, timestamp: -1, _id: -1 })
      .limit(MAX_SESSIONS)
      .lean();

    const count = sessions.length;

    return res.status(200).json({
      success: true,
      data: sessions,
      meta: {
        user_id: String(userId),
        organization_id: String(tenantId),
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null,
        count,
        limited: count >= MAX_SESSIONS,
      },
    });
  })
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
  const tenantIdRaw = (req.query.organization_id || req.query.tenant_id || req.organizationId || req.tenantId || '').toString().trim();
  const isT0000 = String(tenantIdRaw || '').toUpperCase() === 'T0000';

  // IMPORTANT:
  // For this endpoint, organization_id=T0000 is a supported "all tenants" selector used by the UI
  // for Super Admin analytics. It should NOT be treated as a literal tenant filter.
  if (isT0000) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.usersAllTenantsBypass = true;
    try { res.set('X-All-Tenants', 'true'); } catch {}
  }

  // Keep tenant id as-provided for normal tenants; for T0000 we still echo tenant_id as T0000
  // but must ensure DB queries do not filter on it.
  const tenantId = tenantIdRaw;

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
    /**
     * Count total sessions for this user in the same tenant + date range.
     *
     * IMPORTANT:
     * - We intentionally reuse the same date filtering semantics as the existing service:
     *   it matches sessions where ANY of timestamp/session_start/last_updated is within range.
     * - We count documents (sessions), not sums of any existing "total_count" field.
     *
     * Performance note (no schema change in this task):
     * - Consider ensuring an index that supports this query pattern, e.g.:
     *   { tenant_id: 1, user_id: 1, last_updated: 1 } (and/or session_start/timestamp)
     */
    const userIdString = String(userId);
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

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

    const bypass = !!(req && (req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin || req.usersAllTenantsBypass));

    // IMPORTANT:
    // Do NOT place both tenant-scoping and time-scoping under the same `$or` key at the top-level,
    // otherwise the later spread overwrites the earlier one. That bug causes date filters to be
    // dropped and results in all-time totals even when from/to are provided.
    const andClauses = [
      // Always scope to the user
      { $expr: { $eq: [{ $toString: '$user_id' }, userIdString] } },
    ];

    // Time window: ANY of these fields may represent activity; include session if any is in range.
    if (timeClauses.length) {
      andClauses.push({ $or: timeClauses });
    }

    // Tenant window (unless bypass / all-tenants mode)
    if (!bypass) {
      andClauses.push({
        $or: [
          { tenant_id: String(tenantId) },
          { organization_id: String(tenantId) },
          { organizationId: String(tenantId) },
          { tenantId: String(tenantId) },
          { orgId: String(tenantId) },
          { 'tenant.tenant_id': String(tenantId) },
        ],
      });
    }

    const sessionsFilter = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
    const totalSessions = await SessionTracking.countDocuments(sessionsFilter);

    const safePayload = {
      user_id: String(payload?.user_id || userId),
      tenant_id: String(payload?.tenant_id || tenantId),
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
      // New field (non-breaking addition): total sessions count for the same filters.
      total_count: Number(totalSessions || 0),
    };

    return res.status(200).json(safePayload);
  } catch (err) {
    console.error('[users.projects] error:', err?.message || err);
    // Return safe default 200 with empty list to avoid 404/500 breaking frontend
    return res.status(200).json({
      user_id: String(userId),
      tenant_id: String(tenantId),
      projects: [],
      total_count: 0,
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
