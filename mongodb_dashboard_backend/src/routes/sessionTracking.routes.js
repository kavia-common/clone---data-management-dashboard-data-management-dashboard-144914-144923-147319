const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * Flags
 *
 * IMPORTANT:
 * ENABLE_ROUTE_CACHE is an opt-in performance feature and must follow the normal convention:
 * - "true"  => caching enabled
 * - "false" => caching disabled
 *
 * A previous implementation accidentally inverted this logic, which could cause unexpected cache
 * HITs and return stale/unfiltered results even when q filters were applied.
 */
const ENABLE_ROUTE_CACHE = String(process.env.ENABLE_ROUTE_CACHE || 'true').toLowerCase() === 'true';
const ENABLE_ETAG = String(process.env.ENABLE_ETAG || 'true').toLowerCase() === 'true';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60);
const DEFAULT_CACHE_TTL_MS = Math.max(5, CACHE_TTL_SECONDS) * 1000;

/**
 * Helpers
 */

/**
 * Round an ISO date-time string down to the minute.
 * Used to reduce cache key cardinality for time-bounded queries.
 */
function roundToMinuteISO(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

/**
 * Flow: SessionTrackingUserNameExactMatchFilterFlow
 *
 * Contract:
 * - Inputs:
 *   - qRaw: any (typically req.query.q)
 * - Output:
 *   - { filter, qTrimmed, shouldReturnEmpty }
 *     - filter: MongoDB filter object (either {} or { User_name: <exact> })
 *     - qTrimmed: trimmed string
 *     - shouldReturnEmpty: boolean; if true, caller should return empty results immediately
 * - Behavior:
 *   - If qRaw is not a string => no-op filter ({}).
 *   - If qRaw is a string but trims to empty => caller should return empty results.
 *   - Otherwise => exact match ONLY on canonical field `User_name`.
 * - Errors: none
 * - Side effects: none
 */
function buildExactUserNameFilterFromQ(qRaw) {
  if (typeof qRaw !== 'string') {
    return { filter: {}, qTrimmed: '', shouldReturnEmpty: false };
  }

  const qTrimmed = qRaw.trim();
  if (!qTrimmed) {
    // Explicit requirement: when "Filter by User name" has no usable value,
    // do not return all sessions; return empty.
    return { filter: {}, qTrimmed: '', shouldReturnEmpty: true };
  }

  return { filter: { User_name: qTrimmed }, qTrimmed, shouldReturnEmpty: false };
}

/**
 * Escape user input so it is treated as literal text in a RegExp.
 * This prevents regex injection and reduces the risk of catastrophic backtracking patterns.
 *
 * NOTE: This helper is kept for backwards compatibility and other potential query modes,
 * but the "Filter by User name" flow below intentionally uses exact match only.
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
 *
 * NOTE: This is not used for the "Filter by User name" behavior; that flow requires exact match.
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

const routeCache = new Map();
function cacheKeyFromReq(req, enforcedTenant) {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
  const start = roundToMinuteISO(req.query.start || req.query.from || '');
  const end = roundToMinuteISO(req.query.end || req.query.to || '');

  // IMPORTANT:
  // Cache keys MUST reflect the *effective* scope, not just the raw requested tenant.
  // In particular, when the caller triggers "all tenants" behavior (T0000 sentinel),
  // we must not cache under tenant="T0000" because the effective filter is unscoped
  // and could be reused across other scoped requests.
  const effectiveTenant =
    (req.tenantScopeDisabled || req.allTenants || req.sessionsAllTenantsBypass)
      ? 'all-tenants'
      : (enforcedTenant ? String(enforcedTenant) : 'n/a');

  // Prevent cache-key collisions between the same router mounted at different base paths
  // (e.g. /api/session-tracking vs /api/session-tracking/table).
  const routePath =
    `GET:${(req.baseUrl || '')}${(req.path || '')}` ||
    `GET:${req.originalUrl || '/api/session-tracking'}`;

  return JSON.stringify({
    route: routePath,
    tenant: effectiveTenant,
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
  } catch {}
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

    // Inputs for filtering
    // IMPORTANT: For the Sessions table, `q` is treated as "Filter by User name" only.
    // It must be an EXACT match on `User_name` and must not trigger other search filters.
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const qRaw = req.query.q;

    let searchFilter = {};

    // Keep explicit userId behavior when the client sends it.
    // (This task only changes the "Filter by User name" behavior, i.e. q.)
    if (userId) {
      // Exact equality on user_id
      searchFilter = { user_id: userId };
    } else {
      const { filter, qTrimmed, shouldReturnEmpty } = buildExactUserNameFilterFromQ(qRaw);

      if (typeof qRaw === 'string') {
        // Required per request: log what the backend is searching for.
        // (Safe: already user-provided input; no secrets.)
        console.log('[sessionTracking:list] searched User_name:', qTrimmed || '(empty)');
      }

      if (shouldReturnEmpty) {
        // Return empty results when filter-by-username is present but has no exact-match value.
        if (explicit) {
          return res.status(200).json({ success: true, data: [], meta: { page, limit, total: 0 } });
        }
        return res.status(200).json([]);
      }

      if (qTrimmed) {
        const MAX_Q_LENGTH = Number(process.env.SESSION_TRACKING_MAX_Q_LENGTH || 128);
        if (qTrimmed.length > MAX_Q_LENGTH) {
          return res.status(400).json({
            success: false,
            message: `q is too long (max ${MAX_Q_LENGTH} characters)`,
          });
        }
      }

      // Exact match ONLY on the canonical field name.
      searchFilter = filter;
    }

    // Derive a stable q value for cache/etag/debug context.
    const qContext =
      (typeof qRaw === 'string' && qRaw.trim())
        ? qRaw.trim()
        : '';

    // Ignore client filter param for this route
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
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

    // Debug logging (temporary): helps diagnose why filtering returns empty.
    // Logs: query inputs, resolved tenant, and a sample of user_name values from returned records.
    const DEBUG_SESSION_TRACKING_LOGS =
      String(process.env.DEBUG_SESSION_TRACKING_LOGS || '').toLowerCase() === 'true';

    if (DEBUG_SESSION_TRACKING_LOGS) {
      try {
        // The single most useful debug artifact for this bug report:
        // print the final MongoDB filter that will be used for find()/countDocuments().
        console.log('[sessionTracking:list] final MongoDB filter:', JSON.stringify(finalFilter));

        console.log('[sessionTracking:list] request', {
          path: req.path,
          query: {
            page: req.query.page,
            limit: req.query.limit,
            pageSize: req.query.pageSize,
            sort: req.query.sort,
            q: req.query.q,
            userId: req.query.userId,
            start: req.query.start,
            end: req.query.end,
            from: req.query.from,
            to: req.query.to,
            // NOTE: filter is intentionally ignored by this route, but useful to see if clients send it
            filter: typeof req.query.filter === 'undefined' ? undefined : req.query.filter,
          },
          tenant: {
            bypass,
            enforcedTenant,
            reqTenantId: req.tenantId || null,
            tenantScopeDisabled: !!req.tenantScopeDisabled,
            allTenants: !!req.allTenants,
            sessionsAllTenantsBypass: !!req.sessionsAllTenantsBypass,
          },
          derived: {
            explicitPagination: !!explicit,
            page,
            limit,
            skip,
            sort,
            q: qContext,
            userId,
          },
          finalFilter,
        });
      } catch {}
    }

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

        if (DEBUG_SESSION_TRACKING_LOGS) {
          try {
            const cachedDocs = Array.isArray(hit.payload)
              ? hit.payload
              : Array.isArray(hit.payload?.data)
                ? hit.payload.data
                : [];
            const sampleNames = cachedDocs
              .slice(0, 50)
              .map((d) => d?.user_name ?? d?.User_name ?? null)
              .filter((v) => typeof v === 'string' && v.trim().length > 0);

            console.log('[sessionTracking:list] cache HIT', {
              cacheKey,
              count: cachedDocs.length,
              user_name_sample: sampleNames.slice(0, 20),
            });
          } catch {}
        }

        return res.status(200).json(hit.payload);
      }

      if (DEBUG_SESSION_TRACKING_LOGS) {
        try {
          console.log('[sessionTracking:list] cache MISS', {
            cacheKey,
            effectiveTenant: (req.tenantScopeDisabled || req.allTenants || req.sessionsAllTenantsBypass) ? 'all-tenants' : (enforcedTenant || null),
            q: qContext,
          });
        } catch {}
      }
    }

    // DB execution
    try {
      if (explicit) {
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
          SessionTracking.countDocuments(finalFilter),
        ]);

        if (DEBUG_SESSION_TRACKING_LOGS) {
          try {
            const names = docs
              .slice(0, 50)
              .map((d) => d?.user_name ?? d?.User_name ?? null)
              .filter((v) => typeof v === 'string' && v.trim().length > 0);

            console.log('[sessionTracking:list] db result (paginated)', {
              count: docs.length,
              total,
              user_name_sample: names.slice(0, 20),
              hasAnyUserName: names.length > 0,
            });
          } catch {}
        }

        const payload = { success: true, data: docs, meta: { page, limit, total } };
        let etag = null;
        if (wantETag) {
          etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : enforcedTenant, page, limit, sort, q: qContext, userId });
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

      if (DEBUG_SESSION_TRACKING_LOGS) {
        try {
          const names = docs
            .slice(0, 50)
            .map((d) => d?.user_name ?? d?.User_name ?? null)
            .filter((v) => typeof v === 'string' && v.trim().length > 0);

          console.log('[sessionTracking:list] db result (unpaginated)', {
            count: docs.length,
            user_name_sample: names.slice(0, 20),
            hasAnyUserName: names.length > 0,
          });
        } catch {}
      }

      const payload = docs;
      let etag = null;
      if (wantETag) {
        etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : enforcedTenant, sort, q: qContext, userId });
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
      if (DEBUG_SESSION_TRACKING_LOGS) {
        try {
          console.log('[sessionTracking:list] error', {
            message: err?.message || String(err),
            stack: err?.stack,
          });
        } catch {}
      }

      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || ''
      });
    }
  })
);

// CRUD operations invalidate cache
router.post('/', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.create), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.put('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.update), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.delete('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.remove), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });

// Keep ID read unchanged
router.get('/:id', asyncHandler(controller.getById));

module.exports = router;
