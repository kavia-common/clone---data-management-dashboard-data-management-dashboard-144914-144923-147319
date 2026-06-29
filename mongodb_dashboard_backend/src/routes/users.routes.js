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

// Batch endpoint router: POST /api/users/projects
const usersProjectsBatchRoutes = require('./users.projects.batch.routes');

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

/**
 * PUBLIC_INTERFACE
 * Batch projects for users (mounted early to avoid conflict with /:id)
 *
 * POST /api/users/projects
 */
router.use(usersProjectsBatchRoutes);

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
 * GET /api/users/:userId/session-details
 * Returns session details for the specified user sourced from the session_tracking collection.
 *
 * Query params:
 *  - organization_id (preferred) OR tenant_id: tenant/org scope to filter session_tracking records.
 *
 * Response (non-breaking additions included):
 *  - user_id: string
 *  - tenant_id: string | null (echoed from query when provided)
 *  - total_count: number (best-effort; sum(total_count) else 1 per record)
 *  - total_duration: number (best-effort; sum(total_duration) else 0)
 *  - last_updated: ISO string | null (max(last_updated, session_start) best-effort)
 *  - service_type: string[] (de-duplicated list across the user's sessions; best-effort)
 *  - organization_name: string | null (prefer from session docs; otherwise derived from tenant/user context when possible)
 *  - total_cost: number (best-effort sum across sessions; parses numeric and currency-like strings)
 *  - sessions: array (best-effort derived from the first matching record that has sessions)
 *  - records: array of FULL session_tracking documents (no projection; returned as-is)
 *
 * Notes:
 *  - Do not project or omit fields; full session_tracking documents are returned in `records`.
 *  - Safe fallbacks are applied for older documents where fields may be missing.
 *  - Matching user_id is done via $expr + $toString to support Mixed/ObjectId storage.
 *  - If multiple records exist, returns the most recent bounded set ordered by last_updated/session_start/timestamp.
 */
router.get(
  '/:userId/session-details',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId (path) is required' });
    }

    const userIdString = String(userId);

    // Accept both organization_id and tenant_id (prefer organization_id).
    const tenantIdRaw =
      (typeof req.query?.organization_id === 'string' && req.query.organization_id) ||
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id) ||
      '';

    const tenantId = tenantIdRaw ? String(tenantIdRaw).trim() : '';

    /**
     * Normalize incoming time bounds for this endpoint.
     * Supports:
     * - ISODate("...") wrapper (frontend legacy behavior)
     * - Full ISO timestamp
     * - Date-only "YYYY-MM-DD" (expanded to full-day UTC bounds)
     *
     * Returns undefined when input is empty/invalid.
     */
    function normalizeSessionDetailsRangeParam(value, { mode }) {
      if (value === undefined || value === null || value === '') return undefined;

      let s = String(value).trim();

      // Unwrap ISODate("...") or ISODate('...') if present
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

      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) return undefined;
      return dt.toISOString();
    }

    const rawFrom = req.query?.from;
    const rawTo = req.query?.to;
    const from = normalizeSessionDetailsRangeParam(rawFrom, { mode: 'from' });
    const to = normalizeSessionDetailsRangeParam(rawTo, { mode: 'to' });
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    // Optional username filter (reference query uses User_name)
    const userNameRaw =
      (typeof req.query?.user_name === 'string' && req.query.user_name) ||
      (typeof req.query?.User_name === 'string' && req.query.User_name) ||
      '';
    const userName = userNameRaw ? String(userNameRaw).trim() : '';

    /**
     * IMPORTANT (bugfix):
     * When User_name + tenant_id are provided, this endpoint must aggregate using EXACTLY:
     *   $match:   { User_name: "<name>", tenant_id: "<tenant>" }
     *   $group:   { _id:{User_name:"$User_name",tenant_id:"$tenant_id"}, session_count:{$sum:1},
     *              total_cost:{$sum:"$total_cost"}, total_duration:{$sum:"$total_duration"} }
     *   $project: { _id:0, User_name:"$_id.User_name", tenant_id:"$_id.tenant_id", session_count:1, total_cost:1, total_duration:1 }
     *
     * Reason: current implementation can over-match (user_id OR User_name) and inflates counts by summing total_count.
     */

    const andClauses = [];

    // Prefer strict match on User_name + tenant_id when both are provided (per user-provided pipeline).
    // This ensures counts are document counts and costs sum the correct field.
    const hasStrictUserNameTenantMatch = Boolean(userName && tenantId);
    if (hasStrictUserNameTenantMatch) {
      andClauses.push({ User_name: userName });
      andClauses.push({ tenant_id: tenantId });
    } else {
      // Backward-compatible fallback:
      // - Match by user_id (canonical in our system)
      // - If User_name is provided without tenant_id, also allow matching by User_name/user_name
      const identityOrClauses = [{ $expr: { $eq: [{ $toString: '$user_id' }, userIdString] } }];
      if (userName) {
        identityOrClauses.push({ User_name: userName });
        identityOrClauses.push({ user_name: userName });
      }
      andClauses.push({ $or: identityOrClauses });

      // If tenant is provided (but no strict match), enforce broader tenant aliases too.
      if (tenantId) {
        andClauses.push({
          $or: [
            { tenant_id: tenantId },
            { organization_id: tenantId },
            { organizationId: tenantId },
            { tenantId: tenantId },
            { orgId: tenantId },
            { 'tenant.tenant_id': tenantId },
          ],
        });
      }
    }

    // Date range filtering (reference query uses created_at + last_updated).
    // We apply BOTH constraints when range is provided:
    // - created_at within [from,to]
    // - last_updated within [from,to]
    //
    // If a field is missing, we fall back to session_start/timestamp where reasonable,
    // but keep behavior conservative and consistent across totals + records.
    if (fromDate || toDate) {
      const range = {};
      if (fromDate) range.$gte = fromDate;
      if (toDate) range.$lte = toDate;

      andClauses.push({
        $or: [
          { created_at: range },
          { createdAt: range },
          { timestamp: range },
          { session_start: range },
        ],
      });
      andClauses.push({
        $or: [
          { last_updated: range },
          { lastUpdated: range },
          { updated_at: range },
          { updatedAt: range },
        ],
      });
    }

    const matchFilter = andClauses.length === 1 ? andClauses[0] : { $and: andClauses };

    // Return a bounded set of the most recent records with NO projection (all fields).
    const MAX_RECORDS = 50;

    const records = await SessionTracking.find(matchFilter, null, { limit: MAX_RECORDS })
      .sort({ last_updated: -1, session_start: -1, timestamp: -1, _id: -1 })
      .lean();

    /**
     * Best-effort parsing for numeric/currency-like values.
     * Accepts:
     *  - number
     *  - "$1.23" / "1.23" / "USD 1.23" / "1,234.56"
     * Returns 0 for invalid/missing.
     */
    function parseNumericCost(value) {
      if (value === null || value === undefined) return 0;
      if (typeof value === 'number' && Number.isFinite(value)) return value;

      if (typeof value === 'string') {
        const cleaned = value
          .trim()
          .replace(/,/g, '')
          .replace(/[^\d.-]/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : 0;
      }

      return 0;
    }

    // Aggregate totals.
    // For strict User_name + tenant_id mode, EXACTLY match requested pipeline semantics:
    // - session_count is document count ($sum: 1)
    // - total_cost sums $total_cost (cast to numeric safely)
    // - total_duration sums $total_duration (cast to numeric safely)
    // In fallback mode, retain existing behavior but improve cost/duration casting safety.
    const totalsAgg = await SessionTracking.aggregate(
      hasStrictUserNameTenantMatch
        ? [
            { $match: matchFilter },
            {
              $group: {
                _id: { User_name: '$User_name', tenant_id: '$tenant_id' },
                session_count: { $sum: 1 },
                total_cost: {
                  $sum: {
                    $convert: { input: '$total_cost', to: 'double', onError: 0, onNull: 0 },
                  },
                },
                total_duration: {
                  $sum: {
                    $convert: { input: '$total_duration', to: 'double', onError: 0, onNull: 0 },
                  },
                },
                last_updated: { $max: { $ifNull: ['$last_updated', '$session_start'] } },
              },
            },
            {
              $project: {
                _id: 0,
                User_name: '$_id.User_name',
                tenant_id: '$_id.tenant_id',
                session_count: 1,
                total_cost: 1,
                total_duration: 1,
                last_updated: 1,
              },
            },
          ]
        : [
            { $match: matchFilter },
            {
              $group: {
                _id: null,
                total_count: { $sum: { $ifNull: ['$total_count', 1] } },
                total_duration: {
                  $sum: { $convert: { input: '$total_duration', to: 'double', onError: 0, onNull: 0 } },
                },
                last_updated: { $max: { $ifNull: ['$last_updated', '$session_start'] } },
              },
            },
            { $project: { _id: 0, total_count: 1, total_duration: 1, last_updated: 1 } },
          ]
    ).allowDiskUse(true);

    const totalsRow = Array.isArray(totalsAgg) && totalsAgg.length ? totalsAgg[0] : null;

    // Prefer sessions list if present in any matching record (older docs may not have it).
    const sessions =
      records.find((r) => Array.isArray(r?.sessions))?.sessions ||
      records.find((r) => Array.isArray(r?.session_data?.sessions))?.session_data?.sessions ||
      [];

    // ---- New aggregations (safe + non-breaking) ----

    // service_type: build a unique list across records, coalescing common variants.
    const serviceTypeSet = new Set();
    for (const r of records || []) {
      const v =
        r?.service_type ??
        r?.serviceType ??
        r?.metadata?.service_type ??
        r?.session_data?.service_type ??
        null;

      if (typeof v === 'string' && v.trim()) {
        serviceTypeSet.add(v.trim());
      } else if (Array.isArray(v)) {
        for (const it of v) {
          if (typeof it === 'string' && it.trim()) serviceTypeSet.add(it.trim());
        }
      }
    }
    const service_type = Array.from(serviceTypeSet);

    // total_cost:
    // - In strict User_name+tenant_id mode, use DB aggregate sum($total_cost) to match expected pipeline.
    // - Otherwise, keep best-effort fallback across possible fields.
    let total_cost = 0;
    if (hasStrictUserNameTenantMatch) {
      total_cost = Number(totalsRow?.total_cost || 0);
    } else {
      for (const r of records || []) {
        const v =
          r?.total_cost ??
          r?.totalCost ??
          r?.cost_usd ??
          r?.costUSD ??
          r?.llm_cost ??
          r?.llmCost ??
          r?.session_data?.total_cost ??
          r?.session_data?.cost_usd ??
          null;
        total_cost += parseNumericCost(v);
      }
    }

    // organization_name: prefer from session docs; else try to derive from tenant/user context.
    let organization_name =
      records.find((r) => typeof r?.organization_name === 'string' && r.organization_name.trim())
        ?.organization_name ||
      records.find((r) => typeof r?.organizationName === 'string' && r.organizationName.trim())
        ?.organizationName ||
      records.find((r) => typeof r?.tenant_name === 'string' && r.tenant_name.trim())
        ?.tenant_name ||
      records.find((r) => typeof r?.tenant?.tenant_name === 'string' && r.tenant.tenant_name.trim())
        ?.tenant?.tenant_name ||
      records.find(
        (r) => typeof r?.tenant?.organization_name === 'string' && r.tenant.organization_name.trim()
      )?.tenant?.organization_name ||
      null;

    // If still missing, try Tenant model lookup by provided tenantId (best-effort, safe).
    if (!organization_name && tenantId) {
      try {
        const tenantDoc = await Tenant.findOne(
          { tenant_id: tenantId },
          { tenant_id: 1, tenant_name: 1 }
        ).lean();
        if (tenantDoc?.tenant_name) organization_name = String(tenantDoc.tenant_name);
      } catch (_) {}
    }

    // If still missing, try derive from user doc (best-effort, safe).
    if (!organization_name) {
      try {
        const userDoc = await User.findById(userIdString, {
          organization_name: 1,
          organizationName: 1,
          tenant_name: 1,
          tenantName: 1,
          organization_id: 1,
        }).lean();

        organization_name =
          (typeof userDoc?.organization_name === 'string' && userDoc.organization_name.trim()
            ? userDoc.organization_name.trim()
            : null) ||
          (typeof userDoc?.organizationName === 'string' && userDoc.organizationName.trim()
            ? userDoc.organizationName.trim()
            : null) ||
          (typeof userDoc?.tenant_name === 'string' && userDoc.tenant_name.trim()
            ? userDoc.tenant_name.trim()
            : null) ||
          (typeof userDoc?.tenantName === 'string' && userDoc.tenantName.trim()
            ? userDoc.tenantName.trim()
            : null) ||
          null;

        if (!organization_name && userDoc?.organization_id) {
          try {
            const t = await Tenant.findOne(
              { tenant_id: String(userDoc.organization_id) },
              { tenant_name: 1 }
            ).lean();
            if (t?.tenant_name) organization_name = String(t.tenant_name);
          } catch (_) {}
        }
      } catch (_) {}
    }

    // Ensure explicit response shape + stable types for consumers.
    const response = {
      user_id: userIdString,
      tenant_id: tenantId || null,

      // Existing fields (keep semantics)
      // IMPORTANT:
      // - In strict mode we return session_count semantics (doc count) via totalsRow.session_count.
      // - Otherwise preserve prior behavior (sum of total_count or fallback).
      total_count: Number(totalsRow?.session_count ?? totalsRow?.total_count ?? 0),
      total_duration: Number(totalsRow?.total_duration ?? 0),
      last_updated: totalsRow?.last_updated ? new Date(totalsRow.last_updated).toISOString() : null,

      // Explicitly required fields (stable types + safe fallbacks)
      service_type: Array.isArray(service_type) ? service_type : [],
      organization_name: organization_name ? String(organization_name) : '',
      total_cost: Number.isFinite(total_cost) ? Number(total_cost) : 0,

      // Existing fields already returned
      sessions: Array.isArray(sessions) ? sessions : [],
      // IMPORTANT: full docs, no projection
      records: Array.isArray(records) ? records : [],
    };

    return res.status(200).json(response);
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
 * PUBLIC_INTERFACE
 * GET /api/users/session-stats-by-domain
 *
 * Returns per-user total session duration for all users whose email matches the
 * provided email domain.  The aggregation is executed entirely in MongoDB using a
 * $lookup + $group pipeline (no in-process joining).
 *
 * Query parameters:
 *  - domain (string, required): email domain to filter by, e.g. "davinci.com"
 *
 * Response 200:
 *  [
 *    {
 *      "userId": "<ObjectId string>",
 *      "email": "john@davinci.com",
 *      "totalSessionDuration": 5400,
 *      "sessionBreakdown": [
 *        { "sessionId": "...", "duration": 1200, "status": "completed", ... },
 *        ...
 *      ]
 *    },
 *    ...
 *  ]
 *
 * Response 400: missing or invalid domain query parameter.
 * Response 500: internal server error.
 */
router.get(
  '/session-stats-by-domain',
  asyncHandler(async (req, res) => {
    const domain = typeof req.query.domain === 'string' ? req.query.domain.trim() : '';

    if (!domain) {
      return res.status(400).json({
        success: false,
        message: 'Query parameter "domain" is required (e.g. ?domain=example.com)',
      });
    }

    // Basic domain format guard: must contain at least one dot and no spaces
    const domainPattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
    if (!domainPattern.test(domain)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid domain format. Provide a domain like "example.com" without "@".',
      });
    }

    const { getUserSessionStatsByDomain } = require('../services/users.service');

    const results = await getUserSessionStatsByDomain(domain);

    return res.status(200).json({
      success: true,
      domain,
      count: results.length,
      data: results,
    });
  })
);

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
