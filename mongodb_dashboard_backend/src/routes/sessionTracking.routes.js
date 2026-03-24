const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

// Flags
const ENABLE_ROUTE_CACHE = String(process.env.ENABLE_ROUTE_CACHE || 'true').toLowerCase() === 'true';
const ENABLE_ETAG = String(process.env.ENABLE_ETAG || 'true').toLowerCase() === 'true';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60);
const DEFAULT_CACHE_TTL_MS = Math.max(5, CACHE_TTL_SECONDS) * 1000;

// Helpers
function roundToMinuteISO(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

/**
 * Escape user input so it is treated as literal text in a RegExp.
 * This prevents regex injection and reduces the risk of catastrophic backtracking patterns.
 */
function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a case-insensitive RegExp for user-supplied q.
 *
 * Contract:
 * - Input: arbitrary user-provided string (already trimmed by caller)
 * - Output: RegExp that matches the literal text, but treats whitespace runs as "\\s+"
 * - Errors: none (always returns a valid RegExp)
 *
 * Why:
 * - Avoids unescaped regex meta characters from causing slow queries or ReDoS-like behavior.
 * - Makes multi-word queries resilient to inconsistent whitespace in stored values.
 */
function buildSafePhraseRegex(qTrimmed) {
  // Split on any whitespace, escape each token, then join with \s+.
  // Example: "Aditi   S" => /Aditi\s+S/i
  const tokens = String(qTrimmed)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map(escapeRegexLiteral);

  const pattern = tokens.length ? tokens.join('\\s+') : '';
  return new RegExp(pattern || escapeRegexLiteral(qTrimmed), 'i');
}

/**
 * Build an $or search filter for session tracking q/userId inputs.
 *
 * Contract:
 * - Inputs:
 *   - q: string (may be empty/whitespace)
 *   - userId: string (may be empty/whitespace)
 * - Output:
 *   - {} when neither is provided
 *   - { user_id: <userId> } when userId is provided (takes precedence)
 *   - { $or: [...] } when q is provided
 * - Errors:
 *   - Throws an Error when q exceeds MAX_Q_LENGTH
 *
 * Invariants:
 * - For multi-word q, user name matching MUST work for both schemas:
 *   - user_name (preferred)
 *   - User_name (legacy)
 * - Full-phrase matching must be whitespace-tolerant (\"Aditi S\" matches \"Aditi   S\").
 * - Token matching for names uses AND semantics across tokens.
 */
// PUBLIC_INTERFACE
function buildSessionTrackingSearchFilter({ q, userId, maxQLength }) {
  /** Build the search filter used by GET /api/session-tracking. */
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  const userIdTrimmed = typeof userId === 'string' ? userId.trim() : '';

  if (userIdTrimmed) {
    // Exact equality on user_id
    return { user_id: userIdTrimmed };
  }

  if (!qTrimmed) return {};

  if (qTrimmed.length > maxQLength) {
    const err = new Error(`q is too long (max ${maxQLength} characters)`);
    err.statusCode = 400;
    throw err;
  }

  // Safe "phrase" regex: literal tokens joined by \s+ so "Aditi S" matches "Aditi  S".
  const phraseRegex = buildSafePhraseRegex(qTrimmed);

  // Single token: allow exact user_id equality fast-path.
  const looksLikeId = !/\s/.test(qTrimmed);

  // User-name fields are historically inconsistent in this collection because:
  // - session_tracking schema is strict:false
  // - ingest pipelines have produced different key casing over time
  //
  // IMPORTANT INVARIANT:
  // Searching by "User name" in the UI must match records regardless of which common
  // variant the document uses.
  const USER_NAME_FIELDS = [
    'user_name', // preferred
    'User_name', // legacy variant observed
    'userName', // camelCase
    'UserName', // camelCase + leading cap
    'username', // compact
    'user', // sometimes used as a label/name in some ingest payloads
    'user_email', // common alias; users may paste email into the user-name search box
    'email', // alias
  ];

  const orParts = [
    // Broad text-like search across key columns
    { task_id: phraseRegex },
    { tenant_id: phraseRegex },
    { organization_name: phraseRegex },

    // User name variants
    ...USER_NAME_FIELDS.map((f) => ({ [f]: phraseRegex })),

    { project_id: phraseRegex },
    { container_id: phraseRegex },
    { service_type: phraseRegex },
    { status: phraseRegex },

    // user_id can be searched too (regex + exact fast-path below)
    { user_id: phraseRegex },

    // nested session data
    { 'session_data.session_name': phraseRegex },
    { 'session_data.description': phraseRegex },
    { 'session_data.llm_model': phraseRegex },
  ];

  if (looksLikeId) {
    orParts.unshift({ user_id: qTrimmed });
    return { $or: orParts };
  }

  // Multi-token name matching: AND of token regexes for each name field.
  // This fixes the previous bug where token matching only applied to phraseRegex and
  // could miss user-name matches depending on spacing/casing.
  const tokens = qTrimmed.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length >= 2) {
    const tokenRegexes = tokens.map((t) => new RegExp(escapeRegexLiteral(t), 'i'));

    const userNameAllTokens = { $and: tokenRegexes.map((r) => ({ user_name: r })) };
    const userNameAllTokensAlt = { $and: tokenRegexes.map((r) => ({ User_name: r })) };

    // Boost the user-name all-token match to the top.
    orParts.unshift({ $or: [userNameAllTokens, userNameAllTokensAlt] });
  }

  return { $or: orParts };
}

const routeCache = new Map();
function cacheKeyFromReq(req, enforcedTenant) {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const start = roundToMinuteISO(req.query.start || req.query.from || '');
  const end = roundToMinuteISO(req.query.end || req.query.to || '');
  const tenant = enforcedTenant ? String(enforcedTenant) : (req.tenantScopeDisabled || req.allTenants ? 'all-tenants' : 'n/a');

  return JSON.stringify({
    route: 'GET:/api/session-tracking',
    tenant,
    page,
    limit,
    q,
    userId,
    start,
    end,
    sort
  });
}
function cacheGet(key) {
  const entry = routeCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    routeCache.delete(key);
    return null;
  }
  return entry;
}
function cacheSet(key, payload, etag) {
  routeCache.set(key, { payload, etag, expiresAt: Date.now() + DEFAULT_CACHE_TTL_MS });
}
function invalidateAllSessionTrackingCache() {
  for (const [k] of routeCache.entries()) {
    if (k.includes('GET:/api/session-tracking')) {
      routeCache.delete(k);
    }
  }
}
function computeETag(payload, context) {
  try {
    const basis = JSON.stringify({
      ctx: context,
      len: Array.isArray(payload) ? payload.length : Array.isArray(payload?.data) ? payload.data.length : null,
      first: Array.isArray(payload) && payload[0]?._id ? String(payload[0]._id) : Array.isArray(payload?.data) && payload.data[0]?._id ? String(payload.data[0]._id) : null,
      last: Array.isArray(payload) && payload[payload.length - 1]?._id ? String(payload[payload.length - 1]._id) : Array.isArray(payload?.data) && payload.data[payload.data.length - 1]?._id ? String(payload.data[payload.data.length - 1]._id) : null,
      max_last_updated: (() => {
        const arr = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : []);
        let max = 0;
        for (const it of arr) {
          const v = new Date(it?.last_updated || it?.timestamp || it?.session_start || 0).getTime();
          if (v > max) max = v;
        }
        return max || null;
      })()
    });
    return crypto.createHash('sha1').update(basis).digest('hex');
  } catch {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return crypto.createHash('sha1').update(s).digest('hex');
  }
}

// Tenant diagnostics
router.use((req, res, next) => {
  try {
    if (req.tenantScopeDisabled || req.allTenants) {
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } else if (req.tenantId) {
      const t = String(req.tenantId);
      res.set('X-Applied-Tenant', t);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: t },
          { organization_id: t },
          { organizationId: t },
        ]
      }));
    }
  } catch { }
  next();
});

/**
 * Normalize a tenant/org id for consistent comparisons.
 * - trims whitespace
 * - uppercases (tenant ids are treated case-insensitively for bypass sentinel)
 */
function normalizeTenantIdForCompare(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

/**
 * Returns true if the value indicates "all tenants" sentinel.
 * Currently supported sentinel: "T0000" (case-insensitive, whitespace-tolerant).
 */
function isAllTenantsSentinel(value) {
  return normalizeTenantIdForCompare(value) === 'T0000';
}

// Early bypass detector
function sessionsEarlyBypassDetector(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/') return next();

  const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id : undefined;
  const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : undefined;

  const hdrOrg =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
    (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
    undefined;

  const authTenant =
    (typeof req?.auth?.tenantId === 'string' && req.auth.tenantId) ||
    (typeof req?.auth?.organization_id === 'string' && req.auth.organization_id) ||
    undefined;

  const requestedTenant = hdrOrg || qOrg || qTenant || authTenant;

  // IMPORTANT: treat sentinel case-insensitively + trim, to avoid accidental empty results
  // from enforcing a literal tenant_id="T0000" filter.
  if (isAllTenantsSentinel(requestedTenant)) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.sessionsAllTenantsBypass = true;

    res.set('X-Tenant-Bypass', 'true');
    res.set('X-Requested-Tenant', 'T0000');
    res.set('X-All-Tenants', 'true');
    res.set('X-Applied-Tenant', 'all-tenants');
  }
  return next();
}

router.get(
  '/',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    // Resolve tenant aliases
    // Resolve tenant aliases (normalized for consistent comparisons)
    const enforcedTenantRaw =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    // Preserve original casing for real tenants, but normalize for sentinel detection.
    const enforcedTenant = enforcedTenantRaw ? String(enforcedTenantRaw).trim() : null;

    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    // Pagination and sort
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Exact userId precedence; q fallback
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';

    let searchFilter = {};
    if (q || userId) {
      // Guardrail: avoid extremely long q creating huge regex scans.
      // This endpoint can scan many fields (and with T0000 can scan across all tenants).
      const MAX_Q_LENGTH = Number(process.env.SESSION_TRACKING_MAX_Q_LENGTH || 128);
      try {
        searchFilter = buildSessionTrackingSearchFilter({ q, userId, maxQLength: MAX_Q_LENGTH });
      } catch (e) {
        const status = e?.statusCode || 400;
        return res.status(status).json({ success: false, message: e?.message || 'Invalid search input' });
      }
    }

    // Ignore client filter param for this route
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch { }
    }

    // Defense in depth: never enforce a literal scope for the "all tenants" sentinel.
    const enforcedScope = (!bypass && enforcedTenant && !isAllTenantsSentinel(enforcedTenant))
      ? {
        $or: [
          { tenant_id: enforcedTenant },
          { organization_id: enforcedTenant },
          { organizationId: enforcedTenant },
        ],
      }
      : {};

    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
    if (!isEmpty(searchFilter)) parts.push(searchFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
    const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

    // Cache handling
    const cacheKey = cacheKeyFromReq(req, enforcedTenant);
    const wantCache = ENABLE_ROUTE_CACHE && req.method === 'GET';
    const wantETag = ENABLE_ETAG && req.method === 'GET';

    if (wantCache) {
      const hit = cacheGet(cacheKey);
      if (hit) {
        if (wantETag) {
          const inm = req.headers['if-none-match'];
          if (inm && inm === hit.etag) {
            res.set('ETag', hit.etag);
            res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
            return res.status(304).end();
          }
        }
        res.set('X-Cache', 'HIT');
        if (wantETag && hit.etag) res.set('ETag', hit.etag);
        res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
        return res.status(200).json(hit.payload);
      }
    }

    // DB execution
    try {
      if (explicit) {
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
          SessionTracking.countDocuments(finalFilter),
        ]);

        const payload = { success: true, data: docs, meta: { page, limit, total } };
        let etag = null;
        if (wantETag) {
          etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : enforcedTenant, page, limit, sort, q, userId });
          res.set('ETag', etag);
        }
        res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
        if (wantCache) {
          cacheSet(cacheKey, payload, etag);
        }

        const inm = req.headers['if-none-match'];
        if (wantETag && inm && etag && inm === etag) {
          return res.status(304).end();
        }
        return res.status(200).json(payload);
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort).lean();

      const payload = docs;
      let etag = null;
      if (wantETag) {
        etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : enforcedTenant, sort, q, userId });
        res.set('ETag', etag);
      }
      res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
      if (wantCache) cacheSet(cacheKey, payload, etag);

      const inm = req.headers['if-none-match'];
      if (wantETag && inm && etag && inm === etag) {
        return res.status(304).end();
      }

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || ''
      });
    }
  })
);

// CRUD operations invalidate cache
router.post('/', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.create), async () => { try { invalidateAllSessionTrackingCache(); } catch { } });
router.put('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.update), async () => { try { invalidateAllSessionTrackingCache(); } catch { } });
router.delete('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.remove), async () => { try { invalidateAllSessionTrackingCache(); } catch { } });

// Keep ID read unchanged
router.get('/:id', asyncHandler(controller.getById));

module.exports = router;
