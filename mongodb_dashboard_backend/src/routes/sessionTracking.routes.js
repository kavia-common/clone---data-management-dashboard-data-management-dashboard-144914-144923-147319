const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const User = require('../models/user.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { resolveTenantContextFromRequest, isAllTenantsSentinel } = require('../services/tenantContextResolve');
const { logMongoExecutionPlan } = require('../utils/mongoQueryDebug');
const util = require('util');

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

  const pattern = tokens.length ? tokens.join('\\s+') : escapeRegexLiteral(qTrimmed);
  return new RegExp(pattern, 'i');
}

/**
 * Normalize a querystring value to a trimmed string (or '').
 *
 * Contract:
 * - Input: any value from req.query[key]
 * - Output: '' if missing/non-stringable; otherwise trimmed string
 * - Notes: supports array query params by taking the first element.
 */
function coerceQueryString(value) {
  if (Array.isArray(value)) return coerceQueryString(value[0]);
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

/**
 * Derive userId from supported query aliases without breaking existing callers.
 *
 * Contract:
 * - Checks (in order): userId, user_id, userID, userid
 * - Returns: '' when not provided
 */
function deriveUserIdFromQuery(query) {
  const candidates = [query?.userId, query?.user_id, query?.userID, query?.userid];
  for (const c of candidates) {
    const v = coerceQueryString(c);
    if (v) return v;
  }
  return '';
}

/**
 * Normalize a MongoDB _id / user_id field to a stable string.
 * This is used only for comparisons and for matching the string form stored in session_tracking.user_id.
 *
 * @param {any} value
 * @returns {string}
 */
function normalizeMongoIdToString(value) {
  if (value === null || typeof value === 'undefined') return '';
  try {
    // Handle ObjectId-ish values
    if (typeof value === 'object' && typeof value.toString === 'function') return String(value.toString());
  } catch {}
  return String(value);
}

/**
 * PUBLIC_INTERFACE
 * resolveUserIdsForQNameSearch
 *
 * Flow name: SessionTrackingQNameToUserIdsFlow
 *
 * Resolve a query string `q` (which may be a user's display name) into one-or-more canonical
 * session-tracking user_id strings.
 *
 * Contract:
 * - Inputs:
 *   - q: trimmed search string (may contain whitespace)
 *   - tenantId: string tenant id (required when bypass=false)
 *   - bypass: boolean; when true, do not tenant-scope the lookup
 * - Output:
 *   - {
 *       userIds: string[],
 *       matched: boolean,
 *       strategy: 'exact-id'|'users-by-name'|'none'
 *     }
 * - Errors:
 *   - Never throws (errors are caught and logged); returns matched:false on failures
 *
 * Notes:
 * - If q already looks like an id, we return it as the single element list (exact-id).
 * - Otherwise, we find *all* users whose name fields match q (case-insensitive, whitespace tolerant),
 *   and return their user_id (or _id fallback) as strings.
 * - Output list is deterministic and de-duplicated.
 */
async function resolveUserIdsForQNameSearch({ q, tenantId, bypass }) {
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  const tenantIdString = tenantId !== undefined && tenantId !== null ? String(tenantId) : '';

  if (!qTrimmed) return { userIds: [], matched: false, strategy: 'none' };

  // Strategy 1: treat q as an explicit id if it resembles one (uuid-ish or long hex-ish)
  // This keeps backward compatibility for UIs that paste user_id directly into q.
  const looksLikeId =
    /^[0-9a-f]{24}$/i.test(qTrimmed) || // Mongo ObjectId
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qTrimmed) || // UUID
    qTrimmed.length >= 32;

  if (looksLikeId) {
    return { userIds: [qTrimmed], matched: true, strategy: 'exact-id' };
  }

  // Strategy 2: resolve via users collection by name-like fields
  const safePhraseRegex = buildSafePhraseRegex(qTrimmed);

  const nameFields = [
    'user_name',
    'User_name',
    'name',
    'displayName',
    'display_name',
    'full_name',
    'fullName',
    'username',
  ];

  const nameOr = nameFields.map((f) => ({
    [f]: { $regex: safePhraseRegex.source, $options: 'i' },
  }));

  /**
   * Tenant scope for user lookup:
   * - When bypass=true (T0000/all-tenants), we MUST NOT scope by tenant at all.
   * - When bypass=false, scope to tenantIdString (as before).
   * - If tenantIdString is empty (can occur in bypass/sentinel flows), treat it as bypass to avoid
   *   accidentally generating an always-false scope.
   */
  const userLookupFilter =
    bypass || !tenantIdString
      ? { $or: nameOr }
      : {
          $and: [
            { $or: nameOr },
            {
              $or: [
                // Common top-level tenant fields
                { organization_id: tenantIdString },
                { tenant_id: tenantIdString }, // tolerate alternate shapes
                { organizationId: tenantIdString },
                { tenantId: tenantIdString },

                // Common nested membership shapes (user belongs to multiple tenants)
                { 'tenants.tenant_id': tenantIdString },
                { 'tenants.organization_id': tenantIdString },
                { 'tenants.id': tenantIdString },
              ],
            },
          ],
        };

  try {
    const docs = await User.find(userLookupFilter, { _id: 1, user_id: 1 }).sort({ _id: 1 }).lean();

    const ids = (Array.isArray(docs) ? docs : [])
      .map((doc) => normalizeMongoIdToString(doc?.user_id) || normalizeMongoIdToString(doc?._id))
      .map((s) => String(s || '').trim())
      .filter(Boolean);

    // De-dupe while preserving order
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
    }

    if (unique.length) {
      if (unique.length === 1) {
        console.log('[sessionTracking.routes] q->userIds resolved single id', {
          q: qTrimmed,
          bypass,
          tenantId: tenantIdString || null,
          userId: unique[0],
        });
      }
      return { userIds: unique, matched: true, strategy: 'users-by-name' };
    }
    return { userIds: [], matched: false, strategy: 'none' };
  } catch (err) {
    console.warn('[sessionTracking.routes] resolveUserIdsForQNameSearch failed', {
      message: err?.message || String(err),
    });
    return { userIds: [], matched: false, strategy: 'none' };
  }
}

/**
 * Build a search filter for session tracking inputs.
 *
 * Contract:
 * - Inputs:
 *   - q: string (may be empty/whitespace)
 *   - userId: string (may be empty/whitespace) [legacy]
 *   - userIds: string[] (optional) preferred multi-id form
 * - Output:
 *   - {} when no search inputs are provided
 *   - { $expr: { $in: [ { $toString: "$user_id" }, [<id1>, <id2>, ...] ] } } when userIds is provided
 *   - { $expr: { $eq: [ { $toString: "$user_id" }, <userIdString> ] } } when userId is provided
 *   - { $or: [...] } when q is provided
 * - Errors:
 *   - Throws an Error when q exceeds MAX_Q_LENGTH
 *
 * Invariants:
 * - When filtering by userId(s), we match session_tracking.user_id *string form* to avoid type mismatches
 *   (some datasets store user_id as ObjectId, some as string/uuid).
 * - When filtering by q (name search), we match ONLY the top-level `User_name` field (case-insensitive),
 *   preserving the existing $or shape for backward compatibility with debug/caching assumptions.
 */
// PUBLIC_INTERFACE
function buildSessionTrackingSearchFilter({ q, userId, userIds, maxQLength }) {
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  const userIdTrimmed = typeof userId === 'string' ? userId.trim() : '';

  const userIdsArray = Array.isArray(userIds) ? userIds : [];
  const userIdsTrimmed = userIdsArray
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  console.log('[SEARCH] qTrimmed:', qTrimmed);
  console.log('[SEARCH] userId:', userIdTrimmed);
  console.log('[SEARCH] userIds:', userIdsTrimmed);

  // ✅ PRIORITY: userIds match (type-safe via $toString)
  if (userIdsTrimmed.length) {
    return { $expr: { $in: [{ $toString: '$user_id' }, userIdsTrimmed] } };
  }

  // ✅ Next: single userId match (legacy)
  if (userIdTrimmed) {
    return { $expr: { $eq: [{ $toString: '$user_id' }, String(userIdTrimmed)] } };
  }

  if (!qTrimmed) return {};

  if (qTrimmed.length > maxQLength) {
    const err = new Error(`q is too long (max ${maxQLength} characters)`);
    err.statusCode = 400;
    throw err;
  }

  // Some datasets use different casing/field names for user display name.
  // To make q-search reliable (especially when q->userIds resolution yields no hits),
  // search across a small set of common fields.
  const safePhraseRegex = buildSafePhraseRegex(qTrimmed);

  const userNameFields = [
    'User_name', // legacy/session_tracking canonical in this repo
    'user_name', // common alternate casing
    'username', // sometimes stored in sessions
    'userName', // camelCase variant
  ];

  const finalFilter = {
    $or: userNameFields.map((field) => ({
      [field]: {
        $regex: safePhraseRegex.source,
        $options: 'i',
      },
    })),
  };

  console.log('[SEARCH FILTER]', util.inspect(finalFilter, { depth: null }));

  return finalFilter;
}

const routeCache = new Map();

function cacheKeyFromReq(req, enforcedTenant) {
  /**
   * Route cache key for session-tracking list/table endpoints.
   *
   * Flow name: SessionTrackingRouteCacheKeyFlow
   *
   * Contract:
   * - Must vary by:
   *   - actual mounted route (so /api/session-tracking and /api/session-tracking/table never collide)
   *   - effective tenant scope / bypass state
   *   - paging/sort/time window inputs
   *   - q + userId inputs
   *   - IMPORTANT: effective MongoDB filter (fingerprinted as JSON)
   *   - IMPORTANT: resolved q(name)->userIds (fingerprinted) when present
   *
   * Why:
   * - Prevents cache collisions where a request with a restrictive filter (q->userIds)
   *   accidentally reuses a cache entry created for an unfiltered/legacy-q request.
   *
   * Implementation note:
   * - Prefer deriving key material directly from request inputs and the computed DB filter
   *   (req.sessionTrackingEffectiveDbFilter) rather than relying on mutable, optional stamps.
   */
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort =
    typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';
  const q = coerceQueryString(req.query.q);

  // IMPORTANT: must match the same alias resolution used by the handler (deriveUserIdFromQuery),
  // otherwise cache keys can collide and return stale/unfiltered results even when finalFilter is correct.
  const userId = deriveUserIdFromQuery(req.query);
  const start = roundToMinuteISO(req.query.start || req.query.from || '');
  const end = roundToMinuteISO(req.query.end || req.query.to || '');

  // Include the actual mount path to avoid collisions between:
  // - /api/session-tracking
  // - /api/session-tracking/table
  // - /api/sessionTracking (legacy alias)
  // - /api/sessionTracking/table (legacy alias)
  const route = `GET:${req.baseUrl || ''}${req.path || ''}`;

  // Include the canonical tenant/bypass resolution so cache never crosses scope boundaries.
  const { bypass, tenantId, requestedTenantRaw } = resolveTenantContextFromRequest(req);

  const effectiveTenantKey = bypass
    ? `all-tenants:${String(requestedTenantRaw || 'T0000')}`
    : String(enforcedTenant || tenantId || 'n/a');

  // Resolved-userIds fingerprint (when q->userIds resolution occurred)
  const resolvedUserIds = Array.isArray(req.sessionTrackingResolvedUserIds)
    ? req.sessionTrackingResolvedUserIds.map((v) => String(v || '').trim()).filter(Boolean)
    : [];

  const resolvedUserIdsFingerprint = resolvedUserIds.length
    ? crypto.createHash('sha1').update(resolvedUserIds.join(',')).digest('hex')
    : '';

  // Effective DB filter fingerprint: hash of the JSON-stable representation of the filter that will be used.
  // This is the strongest guarantee that cached payloads match executed queries.
  const effectiveDbFilter =
    req.sessionTrackingEffectiveDbFilter && typeof req.sessionTrackingEffectiveDbFilter === 'object'
      ? req.sessionTrackingEffectiveDbFilter
      : null;

  const effectiveDbFilterJson = effectiveDbFilter ? util.inspect(effectiveDbFilter, { depth: null }) : '';
  const effectiveDbFilterFingerprint = effectiveDbFilterJson
    ? crypto.createHash('sha1').update(effectiveDbFilterJson).digest('hex')
    : '';

  // Small guardrail to prevent “same q, different mode” collisions when stamps are missing:
  // if q is present and no explicit userId is present, q resolution was eligible.
  const qResolutionEligible = Boolean(q) && !Boolean(userId);

  return util.inspect({
    route,
    tenant: effectiveTenantKey,
    page,
    limit,
    q,
    userId,
    qResolutionEligible,
    start,
    end,
    sort,
    effectiveDbFilterFingerprint,
    resolvedUserIdsFingerprint,
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
  /**
   * Clear all cached GET responses for session-tracking list/table endpoints.
   */
  for (const [k] of routeCache.entries()) {
    if (k.includes('GET:/api/session-tracking') || k.includes('GET:/api/sessionTracking')) {
      routeCache.delete(k);
    }
  }
}

function computeETag(payload, context) {
  try {
    const basis = util.inspect(
      {
        ctx: context,
        len: Array.isArray(payload)
          ? payload.length
          : Array.isArray(payload?.data)
            ? payload.data.length
            : null,
        first:
          Array.isArray(payload) && payload[0]?._id
            ? String(payload[0]._id)
            : Array.isArray(payload?.data) && payload.data[0]?._id
              ? String(payload.data[0]._id)
              : null,
        last:
          Array.isArray(payload) && payload[payload.length - 1]?._id
            ? String(payload[payload.length - 1]._id)
            : Array.isArray(payload?.data) && payload.data[payload.data.length - 1]?._id
              ? String(payload.data[payload.data.length - 1]._id)
              : null,
        max_last_updated: (() => {
          const arr = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
          let max = 0;
          for (const it of arr) {
            const v = new Date(it?.last_updated || it?.timestamp || it?.session_start || 0).getTime();
            if (v > max) max = v;
          }
          return max || null;
        })(),
      },
      { depth: null }
    );
    return crypto.createHash('sha1').update(basis).digest('hex');
  } catch {
    const s = typeof payload === 'string' ? payload : util.inspect(payload || {});
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
      res.set(
        'X-Applied-Filter',
        util.inspect(
          {
            $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }],
          },
          { depth: null }
        )
      );
    }
  } catch {}
  next();
});

/**
 * Early bypass detector.
 *
 * Contract:
 * - Stamps request flags when the caller indicates the all-tenants sentinel (T0000),
 *   so downstream code can skip tenant scoping.
 * - Does not make authorization decisions; JWT mismatch enforcement is handled in the handler.
 */
function sessionsEarlyBypassDetector(req, res, next) {
  const isListPath = req.path === '/' || req.path === '';
  if (req.method !== 'GET' || !isListPath) return next();

  const { bypass, requestedTenantRaw } = resolveTenantContextFromRequest(req);

  if (bypass && isAllTenantsSentinel(requestedTenantRaw || '')) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.sessionsAllTenantsBypass = true;

    try {
      res.set('X-Tenant-Bypass', 'true');
      res.set('X-Requested-Tenant', 'T0000');
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } catch {}
  }

  return next();
}

router.get(
  '/',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {
    console.log('================ REQUEST START ================');
    console.log('[REQ QUERY]', req.query);

    // Canonical tenant/bypass resolution (shared flow)
    const { bypass, tenantId, requestedTenantRaw } = resolveTenantContextFromRequest(req);
    console.log('[TENANT]', { bypass, tenantId, requestedTenantRaw });

    // Security: if JWT tenant is present, do NOT allow client to broaden scope to "all tenants".
    const authTenant =
      (typeof req?.auth?.tenantId === 'string' && req.auth.tenantId.trim()) ||
      (typeof req?.auth?.organization_id === 'string' && req.auth.organization_id.trim()) ||
      null;

    if (authTenant && isAllTenantsSentinel(requestedTenantRaw || '')) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: all-tenants (T0000) bypass is not allowed with Authorization',
      });
    }

    if (!bypass && !tenantId) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...',
      });
    }

    // Pagination and sort
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Exact userId precedence; q fallback (with q→userIds resolution when q matches a user name)
    const q = coerceQueryString(req.query.q);
    const userIdDirect = deriveUserIdFromQuery(req.query);

    // If userId is explicitly provided, we use it as-is.
    // Otherwise, we attempt to resolve q as a user name to one-or-more canonical userIds.
    const effectiveUserId = userIdDirect;
    let matchedUserIds = [];

    if (!effectiveUserId && q) {
      const resolution = await resolveUserIdsForQNameSearch({ q, tenantId, bypass });
      if (resolution?.matched && Array.isArray(resolution.userIds) && resolution.userIds.length) {
        matchedUserIds = resolution.userIds.map((v) => String(v));

        // IMPORTANT: stamp on req for cache key stability (response headers are not readable here).
        req.sessionTrackingResolvedUserIds = matchedUserIds;

        try {
          // Keep single-id header (first id) for backward compatibility + add multi-id header.
          res.set('X-SessionTracking-Q-Resolved-UserId', String(matchedUserIds[0]));
          res.set('X-SessionTracking-Q-Resolved-UserIds', matchedUserIds.join(','));
          res.set('X-SessionTracking-Q-Resolve-Strategy', String(resolution.strategy || 'unknown'));
        } catch {}
      } else {
        // Ensure cache key doesn't accidentally reuse a prior request's value.
        req.sessionTrackingResolvedUserIds = [];
        try {
          res.set('X-SessionTracking-Q-Resolve-Strategy', String(resolution?.strategy || 'none'));
        } catch {}
      }
    }

    console.log('[SEARCH INPUT]', {
      q,
      userId: userIdDirect,
      effectiveUserId,
      matchedUserIdsCount: matchedUserIds.length,
    });

    let searchFilter = {};
    if (q || effectiveUserId || matchedUserIds.length) {
      // Guardrail: avoid extremely long q creating huge regex scans.
      const MAX_Q_LENGTH = Number(process.env.SESSION_TRACKING_MAX_Q_LENGTH || 128);
      try {
        // If q resolved to userIds, switch search mode to userId(s) filtering.
        // Otherwise, keep legacy q behavior (User_name regex search).
        searchFilter = buildSessionTrackingSearchFilter({
          q: matchedUserIds.length || effectiveUserId ? '' : q,
          userId: effectiveUserId,
          userIds: matchedUserIds,
          maxQLength: MAX_Q_LENGTH,
        });
        console.log('[SEARCH FILTER FINAL]', util.inspect(searchFilter, { depth: null, colors: true }));
      } catch (e) {
        const status = e?.statusCode || 400;
        return res.status(status).json({ success: false, message: e?.message || 'Invalid search input' });
      }
    }

    // Ignore client filter param for this route
    if (typeof req.query.filter !== 'undefined') {
      try {
        res.set('X-Filter-Ignored', 'true');
      } catch {}
    }

    // Tenant scope (only when not bypass)
    let enforcedScope = {};
    if (!bypass && tenantId) {
      enforcedScope = {
        $or: [{ tenant_id: tenantId }, { organization_id: tenantId }, { organizationId: tenantId }],
      };
    }

    // Build final Mongo filter (single canonical code path)
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

    if (!isEmpty(searchFilter)) parts.push(searchFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);

    const finalFilter = parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };

    /**
     * Canonicalize/clamp the DB filter into a safe, reusable object without altering Mongo operators.
     *
     * IMPORTANT:
     * - Do NOT JSON.stringify/parse Mongo filters. That can corrupt operator trees (e.g. $expr),
     *   leading to filters being ignored and returning unfiltered rows/totals.
     * - For caching/debug headers we only need a stable *string representation*; for Mongo queries
     *   we must preserve the original operator structure.
     *
     * Contract:
     * - Input: any MongoDB filter object (or null/undefined)
     * - Output: a plain object suitable for passing to Mongoose find()/countDocuments()
     * - Side effects: none
     *
     * @param {object} filterObj
     * @returns {object}
     */
    function canonicalizeSessionTrackingDbFilter(filterObj) {
      if (!filterObj || typeof filterObj !== "object") return {};
      // Shallow clone is sufficient here since we never mutate nested objects afterwards;
      // it also preserves $expr trees and other Mongo operator objects.
      return { ...filterObj };
    }

    const dbFilter = canonicalizeSessionTrackingDbFilter(finalFilter);

    // Make the effective DB filter explicitly available for cache key generation.
    // This avoids relying on optional stamps that can drift across mounts/middleware.
    req.sessionTrackingEffectiveDbFilter = dbFilter;

    const finalFilterLogJson = util.inspect(dbFilter, { depth: null });
    console.log('[FINAL FILTER]', util.inspect(dbFilter, { depth: null, colors: true }));
    console.log('[FINAL FILTER BEFORE DB]', finalFilterLogJson);

    const filterFingerprint = crypto.createHash('sha1').update(finalFilterLogJson).digest('hex');
    req.sessionTrackingFilterFingerprint = filterFingerprint;

    try {
      res.set('X-SessionTracking-Filter-Fingerprint', filterFingerprint);
      res.set('X-SessionTracking-Filter', finalFilterLogJson);
    } catch {}

    // Cache handling
    const cacheKey = cacheKeyFromReq(req, bypass ? null : tenantId);
    const wantCache = ENABLE_ROUTE_CACHE && req.method === 'GET';
    const wantETag = ENABLE_ETAG && req.method === 'GET';

    if (wantCache) {
      const hit = cacheGet(cacheKey);
      if (hit) {
        console.log('[CACHE] HIT', { cacheKey, filterFingerprint: req.sessionTrackingFilterFingerprint });
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
      console.log('[CACHE] MISS', { cacheKey, filterFingerprint: req.sessionTrackingFilterFingerprint });
    }

    /**
     * Validate that q-search results actually match the q-regex filter.
     * NOTE: Only applies for legacy q-regex mode (User_name search), not userIds filtering mode.
     */
    function validateDocsMatchQNameFilter({ docs, qFilter }) {
      if (!Array.isArray(docs) || !qFilter || typeof qFilter !== 'object') return { ok: true };

      const extractSearchOrClause = (filterObj) => {
        if (!filterObj || typeof filterObj !== 'object') return null;
        if (Array.isArray(filterObj.$or)) return filterObj.$or;
        if (Array.isArray(filterObj.$and)) {
          for (const part of filterObj.$and) {
            if (part && typeof part === 'object' && Array.isArray(part.$or)) return part.$or;
          }
        }
        return null;
      };

      const or = extractSearchOrClause(qFilter);
      if (!or || or.length !== 1) return { ok: true };

      const clause = or[0] || {};
      const userName = clause.User_name;
      if (!userName || typeof userName !== 'object') return { ok: true };

      const pattern = typeof userName.$regex === 'string' ? userName.$regex : null;
      const options = typeof userName.$options === 'string' ? userName.$options : '';
      if (!pattern) return { ok: true };

      let re = null;
      try {
        re = new RegExp(pattern, options.includes('i') ? 'i' : undefined);
      } catch {
        return { ok: true };
      }

      const bad = [];
      for (const d of docs) {
        const value = d?.User_name;
        if (typeof value !== 'string' || !re.test(value)) {
          bad.push({
            _id: d?._id,
            User_name: d?.User_name,
            tenant_id: d?.tenant_id,
            organization_id: d?.organization_id,
          });
          if (bad.length >= 3) break;
        }
      }

      if (bad.length) return { ok: false, reason: 'User_name did not match q regex', sample: bad };
      return { ok: true };
    }

    try {
      console.log('================ DB DEBUG START ================');
      console.log('[DB FILTER RAW]', util.inspect(dbFilter, { depth: null, colors: true }));
      console.log('[DB FILTER TYPE]', typeof dbFilter);
      console.log('[DB FILTER KEYS]', Object.keys(dbFilter));
      if (dbFilter.$and) console.log('[DB FILTER $AND]', util.inspect(dbFilter.$and, { depth: null }));
      if (dbFilter.$or) console.log('[DB FILTER $OR]', util.inspect(dbFilter.$or, { depth: null }));
      console.log('================ DB DEBUG END ==================');

      const runQueries = async ({ phase, cacheBypass }) => {
        const aggPipelineForDebug = [{ $match: dbFilter }, { $count: 'total' }];

        logMongoExecutionPlan({
          label: phase,
          modelName: 'SessionTracking',
          findFilter: dbFilter,
          aggregatePipeline: aggPipelineForDebug,
        });

        const findQuery = SessionTracking.find(dbFilter).sort(sort).skip(skip).limit(limit).lean();

        if (cacheBypass && typeof findQuery?.setOptions === 'function') {
          findQuery.setOptions({ _guardRequery: true, _cacheBypass: true });
        }

        const [docs, totalCount] = await Promise.all([
          findQuery,
          explicit ? SessionTracking.countDocuments(dbFilter) : Promise.resolve(null),
        ]);

        const total = explicit ? Number(totalCount || 0) : null;
        return { docs, total };
      };

      let { docs, total } = await runQueries({ phase: 'initial', cacheBypass: false });

      // Only run the q-regex guard when we're actually in q-regex mode (no matchedUserIds and no explicit userId).
      const inLegacyQNameRegexMode = Boolean(q) && !matchedUserIds.length && !effectiveUserId;

      if (inLegacyQNameRegexMode) {
        const validation1 = validateDocsMatchQNameFilter({ docs, qFilter: dbFilter });
        if (!validation1.ok) {
          console.warn('[SESSION_TRACKING_GUARD] q-search mismatch detected; invalidating cache and re-querying.', {
            filterFingerprint: req.sessionTrackingFilterFingerprint,
            reason: validation1.reason,
            sample: validation1.sample,
          });

          try {
            res.set('X-SessionTracking-Guard', 'mismatch-requery');
            res.set('X-SessionTracking-Guard-Reason', String(validation1.reason || 'mismatch'));
          } catch {}

          try {
            routeCache.delete(cacheKey);
          } catch {}
          try {
            invalidateAllSessionTrackingCache();
          } catch {}

          ({ docs, total } = await runQueries({ phase: 'guard-requery', cacheBypass: true }));

          const validation2 = validateDocsMatchQNameFilter({ docs, qFilter: dbFilter });
          if (!validation2.ok) {
            console.error(
              '[SESSION_TRACKING_GUARD] mismatch persists after forced re-query; enforcing in-memory q filter to guarantee correctness.',
              {
                filterFingerprint: req.sessionTrackingFilterFingerprint,
                reason: validation2.reason,
                sample: validation2.sample,
              }
            );
            try {
              res.set('X-SessionTracking-Guard', 'mismatch-enforced-filter');
            } catch {}

            const extractSearchOrClause = (filterObj) => {
              if (!filterObj || typeof filterObj !== 'object') return null;
              if (Array.isArray(filterObj.$or)) return filterObj.$or;
              if (Array.isArray(filterObj.$and)) {
                for (const part of filterObj.$and) {
                  if (part && typeof part === 'object' && Array.isArray(part.$or)) return part.$or;
                }
              }
              return null;
            };

            const or = extractSearchOrClause(dbFilter);
            const clause = Array.isArray(or) && or.length ? or[0] : null;
            const userName = clause && clause.User_name && typeof clause.User_name === 'object' ? clause.User_name : null;
            const pattern = userName && typeof userName.$regex === 'string' ? userName.$regex : null;
            const options = userName && typeof userName.$options === 'string' ? userName.$options : '';
            let re = null;
            try {
              if (pattern) re = new RegExp(pattern, options.includes('i') ? 'i' : undefined);
            } catch {}

            if (re) docs = docs.filter((d) => typeof d?.User_name === 'string' && re.test(d.User_name));
            else docs = [];
          }
        } else {
          try {
            res.set('X-SessionTracking-Guard', 'ok');
          } catch {}
        }
      }

      // Targeted diagnostics for resolved-userIds mode
      if (Array.isArray(matchedUserIds) && matchedUserIds.length) {
        try {
          res.set('X-SessionTracking-Q-Resolved-UserIds-Count', String(matchedUserIds.length));
        } catch {}

        console.log('[SESSION_TRACKING_Q_RESOLVED_MODE]', {
          q,
          matchedUserIdsCount: matchedUserIds.length,
          matchedUserIdsSample: matchedUserIds.slice(0, 5),
          filterFingerprint: req.sessionTrackingFilterFingerprint,
          docsReturned: Array.isArray(docs) ? docs.length : 0,
          total: explicit ? total : null,
          page,
          limit,
        });
      }

      console.log(
        '[FILTER AFTER DB]',
        JSON.stringify({
          filterFingerprint: req.sessionTrackingFilterFingerprint,
          matchedCount: docs.length,
          total: explicit ? total : undefined,
          sample: docs.slice(0, 3).map((d) => ({
            _id: d?._id,
            User_name: d?.User_name,
            user_id: d?.user_id,
            tenant_id: d?.tenant_id,
            organization_id: d?.organization_id,
          })),
        })
      );

      if (explicit) {
        const payload = {
          success: true,
          data: docs,
          meta: {
            page,
            limit,
            total,
            ...(matchedUserIds.length ? { matchedUserIds } : {}),
          },
        };

        let etag = null;
        if (wantETag) {
          etag = computeETag(payload, {
            tenant: bypass ? 'all-tenants' : tenantId,
            page,
            limit,
            sort,
            q,
            userId: effectiveUserId,
            matchedUserIds,
          });
          res.set('ETag', etag);
        }

        res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
        if (wantCache) cacheSet(cacheKey, payload, etag);

        const inm = req.headers['if-none-match'];
        if (wantETag && inm && etag && inm === etag) return res.status(304).end();

        return res.status(200).json(payload);
      }

      const payload = docs;
      let etag = null;
      if (wantETag) {
        etag = computeETag(payload, {
          tenant: bypass ? 'all-tenants' : tenantId,
          sort,
          q,
          userId: effectiveUserId,
          matchedUserIds,
        });
        res.set('ETag', etag);
      }

      res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS / 1000)}, must-revalidate`);
      if (wantCache) cacheSet(cacheKey, payload, etag);

      const inm = req.headers['if-none-match'];
      if (wantETag && inm && etag && inm === etag) return res.status(304).end();

      return res.status(200).json(payload);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || '',
      });
    }
  })
);

// CRUD operations invalidate cache
router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    next();
  }),
  asyncHandler(controller.create),
  async () => {
    try {
      invalidateAllSessionTrackingCache();
    } catch {}
  }
);

router.put(
  '/:id',
  asyncHandler(async (req, res, next) => {
    next();
  }),
  asyncHandler(controller.update),
  async () => {
    try {
      invalidateAllSessionTrackingCache();
    } catch {}
  }
);

router.delete(
  '/:id',
  asyncHandler(async (req, res, next) => {
    next();
  }),
  asyncHandler(controller.remove),
  async () => {
    try {
      invalidateAllSessionTrackingCache();
    } catch {}
  }
);

// Keep ID read unchanged
router.get('/:id', asyncHandler(controller.getById));

module.exports = router;
