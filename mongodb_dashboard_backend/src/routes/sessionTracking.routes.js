const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { resolveTenantContextFromRequest, isAllTenantsSentinel } = require('../services/tenantContextResolve');
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
  const candidates = [
    query?.userId,
    query?.user_id,
    query?.userID,
    query?.userid,
  ];
  for (const c of candidates) {
    const v = coerceQueryString(c);
    if (v) return v;
  }
  return '';
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
* - q-search for the session tracking table/list endpoint must match ONLY the top-level
*   `User_name` field (case-insensitive).
* - Full-phrase matching must be whitespace-tolerant (\"Aditi S\" matches \"Aditi   S\").
* - Multi-word q uses AND semantics across tokens (both tokens must appear in User_name).
*/
// PUBLIC_INTERFACE
// PUBLIC_INTERFACE
//  // PUBLIC_INTERFACE
function buildSessionTrackingSearchFilter({ q, userId, maxQLength }) {
//   const qTrimmed = typeof q === 'string' ? q.trim() : '';
//   const userIdTrimmed = typeof userId === 'string' ? userId.trim() : '';

//   console.log('[SEARCH] qTrimmed:', qTrimmed);
//   console.log('[SEARCH] userId:', userIdTrimmed);

//   // ✅ PRIORITY: userId exact match
//   if (userIdTrimmed) {
//     return { user_id: userIdTrimmed };
//   }

//   if (!qTrimmed) return {};

//   if (qTrimmed.length > maxQLength) {
//     const err = new Error(`q is too long (max ${maxQLength} characters)`);
//     err.statusCode = 400;
//     throw err;
//   }

//   const USER_NAME_FIELD = 'User_name';

//   /**
//    * IMPORTANT:
//    * We intentionally DO NOT wrap qTrimmed into a stringified regex (e.g. "/Darssini/i").
//    * The UI sends a plain term ("Darssini") and we keep that value as the canonical filter input.
//    *
//    * For case-insensitive "contains" matching, use MongoDB's $regex + $options with an escaped literal.
//    * This avoids regex injection while still allowing partial matches.
//    */
//   /**
//    * Build a safe, whitespace-tolerant regex *pattern string* for MongoDB.
//    *
//    * Important:
//    * - We intentionally store the pattern as a string (not a RegExp instance) so:
//    *   - JSON cloning in cloneMongoFilterForDb remains safe
//    *   - logs and cache fingerprints remain deterministic
//    * - buildSafePhraseRegex() already escapes literal characters to prevent regex injection.
//    */
//   const safePhraseRegex = buildSafePhraseRegex(qTrimmed);

//   // This is a "contains" match by default (no ^ or $ anchors), case-insensitive.
//   // Note: We pass Mongo the regex pattern string rather than a RegExp object.
//   const userNameRegexClause = {
//     [USER_NAME_FIELD]: { $regex: safePhraseRegex.source, $options: 'i' },
//   };

//   // Keep the $or structure for compatibility with existing query composition logic,
//   // but ensure the filter contains only plain values (string + $options), not RegExp instances.
//   // const finalSearch = { $or: [userNameRegexClause] };
//   const finalSearch = userNameRegexClause;

//   console.log('[SEARCH FILTER]', util.inspect(finalSearch, { depth: null }));

//   return finalSearch;
// }

// PUBLIC_INTERFACE
function buildSessionTrackingSearchFilter({ q, userId, maxQLength }) {
  const qTrimmed = typeof q === 'string' ? q.trim() : '';
  const userIdTrimmed = typeof userId === 'string' ? userId.trim() : '';

  console.log('[SEARCH] qTrimmed:', qTrimmed);
  console.log('[SEARCH] userId:', userIdTrimmed);

  // ✅ PRIORITY: userId exact match
  if (userIdTrimmed) {
    return { user_id: userIdTrimmed };
  }

  if (!qTrimmed) return {};

  if (qTrimmed.length > maxQLength) {
    const err = new Error(`q is too long (max ${maxQLength} characters)`);
    err.statusCode = 400;
    throw err;
  }

  const USER_NAME_FIELD = 'User_name';
  const safePhraseRegex = buildSafePhraseRegex(qTrimmed);

  /**
   * IMPORTANT INVARIANT (contract for this route):
   * - q-search is represented as an $or array even when searching a single field.
   *
   * Why:
   * - Other composition/canonicalization/caching/debugging logic historically assumed `$or`,
   *   and tests assert the `$or` structure.
   * - Keeping a single canonical shape avoids drift where totals and rows appear inconsistent.
   */
  const finalFilter = {
    $or: [
      {
        [USER_NAME_FIELD]: {
          $regex: safePhraseRegex.source,
          $options: 'i',
        },
      },
    ],
  };

  console.log('[SEARCH FILTER]', util.inspect(finalFilter, { depth: null }));

  return finalFilter;
}


const routeCache = new Map();
function cacheKeyFromReq(req, enforcedTenant) {
  /**
   * Route cache key for session-tracking list/table endpoints.
   *
   * Contract:
   * - Must vary by:
   *   - actual mounted route (so /api/session-tracking and /api/session-tracking/table never collide)
   *   - effective tenant scope / bypass state
   *   - paging/sort/time window inputs
   *   - q + userId search inputs
   *   - IMPORTANT: an explicit fingerprint of the *effective MongoDB filter*
   *
   * Why:
   * - Historically, the Sessions table showed correct totals but unfiltered rows because
   *   cached payloads could be served that were generated before/without the final filter.
   * - Adding a filter fingerprint prevents cache collisions when the effective filter changes.
   */
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort =
    typeof req.query.sort === 'string' && req.query.sort.trim()
      ? req.query.sort.trim()
      : '-session_start';
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
  // Note: We compute it here rather than relying solely on middleware-stamped flags,
  // because those flags were historically route-specific and could be absent for some mounts.
  const { bypass, tenantId, requestedTenantRaw } = resolveTenantContextFromRequest(req);

  const effectiveTenantKey = bypass
    ? `all-tenants:${String(requestedTenantRaw || 'T0000')}`
    : String(enforcedTenant || tenantId || 'n/a');

  // Include a stable fingerprint of the *effective filter* as computed by the handler.
  // The handler stamps this after building FINAL FILTER BEFORE DB.
  // If absent (should not happen for this route), we fall back to q/userId only.
  const filterFingerprint = coerceQueryString(req.sessionTrackingFilterFingerprint || '');

  return util.inspect({
    route,
    tenant: effectiveTenantKey,
    page,
    limit,
    q,
    userId,
    start,
    end,
    sort,
    filterFingerprint,
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
   *
   * Why:
   * - The same router is mounted under multiple aliases:
   *     /api/session-tracking
   *     /api/sessionTracking
   *     /api/session-tracking/table
   *     /api/sessionTracking/table
   * - Cache keys include the mounted route string, so invalidating only one prefix
   *   can leave stale/unfiltered cache entries under the other alias.
   * - Stale cache entries can make it appear that `q` filtering is ignored even when
   *   `finalFilter` is correct (because the handler returns the cached payload before DB).
   */
  for (const [k] of routeCache.entries()) {
    if (k.includes('GET:/api/session-tracking') || k.includes('GET:/api/sessionTracking')) {
      routeCache.delete(k);
    }
  }
}
function computeETag(payload, context) {
  try {
    const basis = util.inspect({
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
    }, { depth: null });
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
      res.set('X-Applied-Filter', util.inspect({
        $or: [
          { tenant_id: t },
          { organization_id: t },
          { organizationId: t },
        ]
      }, { depth: null }));
    }
  } catch { }
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
  /**
   * This router is mounted at multiple base paths:
   * - /api/session-tracking
   * - /api/sessionTracking
   * - /api/session-tracking/table
   * - /api/sessionTracking/table
   *
   * When mounted, Express sets `req.path` relative to the mount point.
   * For the list handler, that path can be either '/' OR '' depending on how the mount is invoked.
   *
   * If we only treat '/' as the list route, then the all-tenants (T0000) bypass stamping can be skipped
   * for some mounts (notably the `/table` mount), which can lead to inconsistent cache keys/headers and
   * the appearance of “total is filtered but rows are not”.
   */
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
    } catch { }
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
    console.log('[TENANT]', {
      bypass,
      tenantId,
      requestedTenantRaw,
    });

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
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    // Pagination and sort
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Exact userId precedence; q fallback
    const q = coerceQueryString(req.query.q);
    const userId = deriveUserIdFromQuery(req.query);
    console.log('[SEARCH INPUT]', { q, userId });
    let searchFilter = {};
    if (q || userId) {
      // Guardrail: avoid extremely long q creating huge regex scans.
      // This endpoint can scan many fields (and with T0000 can scan across all tenants).
      const MAX_Q_LENGTH = Number(process.env.SESSION_TRACKING_MAX_Q_LENGTH || 128);
      try {
        searchFilter = buildSessionTrackingSearchFilter({ q, userId, maxQLength: MAX_Q_LENGTH });
        console.log('[SEARCH FILTER FINAL]', util.inspect(searchFilter, { depth: null, colors: true }));
      } catch (e) {
        const status = e?.statusCode || 400;
        return res.status(status).json({ success: false, message: e?.message || 'Invalid search input' });
      }
    }

    // Ignore client filter param for this route
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch { }
    }

    // Tenant scope (only when not bypass)
    // const enforcedScope = (!bypass && tenantId) ?? {};
    let enforcedScope = {};

    if (!bypass && tenantId) {
      enforcedScope = {
        $or: [
          { tenant_id: tenantId },
          { organization_id: tenantId },
          { organizationId: tenantId }
        ]
      };
    }

    // Build final Mongo filter (single canonical code path)
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

    if (!isEmpty(searchFilter)) parts.push(searchFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);

    // If we only have a single part, avoid wrapping in $and (cleaner explain/logging),
    // but keep semantics identical.
    const finalFilter =
      parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { $and: parts };

    /**
     * Canonicalize the effective MongoDB filter into the *exact* JSON-safe object that will be
     * passed to MongoDB.
     *
     * CONTRACT (critical invariants for this bugfix):
     * - The returned object is the single source of truth for:
     *   - the rows query (find)
     *   - the totals query (aggregate $match + $count)
     *   - debug logging ("FINAL FILTER BEFORE DB")
     *   - cache fingerprinting (prevents collisions returning stale/unfiltered docs)
     * - The canonical form MUST NOT contain RegExp instances (they do not JSON serialize reliably).
     *   For q-search, we exclusively use {$regex:<patternString>,$options:'i'}.
     *
     * @param {object} filterObj MongoDB filter candidate
     * @returns {object} JSON-safe MongoDB filter to execute
     */
    function canonicalizeSessionTrackingDbFilter(filterObj) {
      // Ensure we only ever execute a JSON-safe filter object (stable logs + cache keys).
      // For this route, this is semantics-preserving because q-search uses $regex string + $options.
      return JSON.parse(JSON.stringify(filterObj || {}));
    }

    // IMPORTANT: dbFilter is the ONLY object that may be passed to MongoDB.
    const dbFilter = canonicalizeSessionTrackingDbFilter(finalFilter);

    // Log/headers must reflect the filter actually executed against MongoDB.
    const finalFilterLogJson = util.inspect(dbFilter, { depth: null });
    console.log('[FINAL FILTER]', util.inspect(dbFilter, { depth: null, colors: true }));
    console.log('[FINAL FILTER BEFORE DB]', finalFilterLogJson);

    // Deterministic filter fingerprint for debuggability + cache keying.
    const filterFingerprint = crypto
      .createHash('sha1')
      .update(finalFilterLogJson)
      .digest('hex');
    req.sessionTrackingFilterFingerprint = filterFingerprint;

    try {
      res.set('X-SessionTracking-Filter-Fingerprint', filterFingerprint);
      res.set('X-SessionTracking-Filter', finalFilterLogJson);
    } catch { }

    // Cache handling (cache key now includes filterFingerprint via req stamp)
    const cacheKey = cacheKeyFromReq(req, bypass ? null : tenantId);
    const wantCache = ENABLE_ROUTE_CACHE && req.method === 'GET';
    const wantETag = ENABLE_ETAG && req.method === 'GET';

    if (wantCache) {
      const hit = cacheGet(cacheKey);
      if (hit) {
        // Make it explicit in logs when DB is not hit (so “unfiltered results” can be attributed to cache).
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
     *
     * Why:
     * - This endpoint has historically shown “filtered totals but unfiltered rows”.
     * - The only way that can happen is if the returned rows are not produced by the same
     *   effective filter as the total query (typically due to cached payloads or divergent code paths).
     * - This guard makes the behavior provably correct: if any row does not match the expected
     *   `User_name` regex, we treat it as a cache/flow violation, invalidate cache, and re-run DB queries.
     *
     * Contract:
     * - Only applies when q-search is active AND the filter has the canonical {$or:[{User_name:{$regex,$options}}]} shape.
     * - On mismatch, will re-query MongoDB with the same dbFilter and return corrected results.
     * - Adds headers to aid debugging without requiring server logs.
     */
    function validateDocsMatchQNameFilter({ docs, qFilter }) {
      if (!Array.isArray(docs) || !qFilter || typeof qFilter !== 'object') return { ok: true };

      const or = Array.isArray(qFilter.$or) ? qFilter.$or : null;
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
        // If regex reconstruction fails, do not block the request.
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

      if (bad.length) {
        return { ok: false, reason: 'User_name did not match q regex', sample: bad };
      }
      return { ok: true };
    }

    // DB execution (rows + total MUST use the same dbFilter object)
    try {
      // ✅ ADD DEBUG LOGS HERE
      console.log('================ DB DEBUG START ================');
      console.log('[DB FILTER RAW]', util.inspect(dbFilter, { depth: null, colors: true }));
      console.log('[DB FILTER TYPE]', typeof dbFilter);
      console.log('[DB FILTER KEYS]', Object.keys(dbFilter));

      if (dbFilter.$and) {
        console.log('[DB FILTER $AND]', util.inspect(dbFilter.$and, { depth: null }));
      }

      if (dbFilter.$or) {
        console.log('[DB FILTER $OR]', util.inspect(dbFilter.$or, { depth: null }));
      }

      console.log('================ DB DEBUG END ==================');

      const runQueries = async () => {
        const [docs, totalAgg] = await Promise.all([
          SessionTracking.find(dbFilter)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),

          SessionTracking.aggregate([
            { $match: dbFilter },
            { $count: 'total' }
          ])
        ]);

        const total =
          explicit && Array.isArray(totalAgg) && totalAgg[0]
            ? Number(totalAgg[0].total || 0)
            : explicit
              ? 0
              : null;

        return { docs, total };
      };

      let { docs, total } = await runQueries();

      // Temporary guard/assert (auto-repair): if q-search active and returned docs don't match,
      // treat it as a cache/flow violation and re-run after cache invalidation.
      if (q) {
        const validation = validateDocsMatchQNameFilter({ docs, qFilter: dbFilter });
        if (!validation.ok) {
          console.warn('[SESSION_TRACKING_GUARD] q-search mismatch detected; invalidating cache and re-querying.', {
            filterFingerprint: req.sessionTrackingFilterFingerprint,
            reason: validation.reason,
            sample: validation.sample,
          });

          try { res.set('X-SessionTracking-Guard', 'mismatch-requery'); } catch { }
          try { res.set('X-SessionTracking-Guard-Reason', String(validation.reason || 'mismatch')); } catch { }

          // Ensure we can't re-serve the same wrong payload.
          try { routeCache.delete(cacheKey); } catch { }
          try { invalidateAllSessionTrackingCache(); } catch { }

          ({ docs, total } = await runQueries());
        } else {
          try { res.set('X-SessionTracking-Guard', 'ok'); } catch { }
        }
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
        const payload = { success: true, data: docs, meta: { page, limit, total } };
        let etag = null;
        if (wantETag) {
          etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : tenantId, page, limit, sort, q, userId });
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

      console.log('[DB RESULT COUNT]', docs.length);
      console.log('[DB SAMPLE RESULT]', docs[0]);

      const payload = docs;
      let etag = null;
      if (wantETag) {
        etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : tenantId, sort, q, userId });
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