const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * SessionTracking aggregates helper
 * IMPORTANT: We must not overwrite stored aggregate fields (total_duration/total_count).
 * The bug report indicates these values exist in MongoDB but were being returned as 0
 * due to mapping/defaulting logic. This route now preserves them and only computes
 * when missing.
 */

// PUBLIC_INTERFACE
function toEpochMs(value) {
  /** Convert a Date/string/number to epoch ms, or null if invalid. */
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const d = new Date(value);
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// PUBLIC_INTERFACE
function computeDurationSecondsFromSegments(doc) {
  /**
   * Compute total duration (seconds) from session_segments when total_duration is absent.
   * Each segment duration is: (end || last_updated) - start.
   *
   * Unit handling:
   * - start/end/last_updated are expected to be Date-like; compute delta in ms then convert to seconds.
   * - Returns a float seconds value (not rounded) to preserve precision like stored 1732.985.
   */
  const segments = doc?.session_segments;
  if (!Array.isArray(segments) || segments.length === 0) return 0;

  const lastUpdatedMs =
    toEpochMs(doc?.last_updated) ??
    toEpochMs(doc?.timestamp) ??
    toEpochMs(doc?.session_start) ??
    null;

  let totalMs = 0;
  for (const seg of segments) {
    const startMs = toEpochMs(seg?.start);
    if (!Number.isFinite(startMs)) continue;

    const endMs = toEpochMs(seg?.end) ?? lastUpdatedMs;
    if (!Number.isFinite(endMs)) continue;

    const delta = Math.max(0, endMs - startMs);
    totalMs += delta;
  }

  return totalMs / 1000;
}

// PUBLIC_INTERFACE
function normalizeTotals(doc) {
  /**
   * Ensure each document includes total_count and total_duration.
   * - If the document already has these fields, preserve them exactly (no default-to-zero).
   * - If missing, compute total_duration from session_segments and total_count from
   *   session_breakdown length (or 1 as last fallback when a single doc represents a user aggregate).
   */
  const out = { ...doc };

  // total_count: preserve if present
  if (out.total_count === undefined || out.total_count === null) {
    const breakdown = out?.session_breakdown;
    if (Array.isArray(breakdown)) out.total_count = breakdown.length;
    else if (breakdown && typeof breakdown === 'object' && Number.isFinite(Number(breakdown.count))) {
      out.total_count = Number(breakdown.count);
    } else {
      // If we can't infer, default to 0 (only when field absent)
      out.total_count = 0;
    }
  }

  // total_duration: preserve if present
  if (out.total_duration === undefined || out.total_duration === null) {
    out.total_duration = computeDurationSecondsFromSegments(out);
  } else {
    // Unit-safe: if stored as ms (very large), normalize to seconds for consistency in UI.
    // Heuristic: values above ~10 million are likely ms (>= ~2.7 hours in ms threshold is 10M).
    if (typeof out.total_duration === 'number' && Number.isFinite(out.total_duration) && out.total_duration > 10_000_000) {
      out.total_duration = out.total_duration / 1000;
    }
  }

  return out;
}

// PUBLIC_INTERFACE
function computeEnvelopeTotals(items) {
  /**
   * Compute top-level totals for paginated response:
   * - total_count: sum of each item's total_count
   * - total_duration: sum of each item's total_duration (seconds)
   */
  let totalCount = 0;
  let totalDuration = 0;

  for (const it of items || []) {
    const c = Number(it?.total_count);
    if (Number.isFinite(c)) totalCount += c;

    const d = typeof it?.total_duration === 'number' ? it.total_duration : Number(it?.total_duration);
    if (Number.isFinite(d)) totalDuration += d;
  }

  return { total_count: totalCount, total_duration: totalDuration };
}

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
  } catch {}
  next();
});

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
  const isT0000 = requestedTenant === 'T0000';

  if (isT0000) {
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
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

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
    if (userId) {
      // Exact equality on user_id
      searchFilter = { user_id: userId };
    } else if (q) {
      const regex = new RegExp(q, 'i');
      const looksLikeId = !/\s/.test(q); // single token
      const orParts = [
        { task_id: regex },
        { tenant_id: regex },
        { organization_name: regex },
        { user_name: regex },
        { User_name: regex },
        { project_id: regex },
        { container_id: regex },
        { service_type: regex },
        { status: regex },
        { user_id: regex },
        { 'session_data.session_name': regex },
        { 'session_data.description': regex },
        { 'session_data.llm_model': regex },
      ];
      if (looksLikeId) {
        orParts.unshift({ user_id: q });
      }
      searchFilter = { $or: orParts };
    }

    // Ignore client filter param for this route
    if (typeof req.query.filter !== 'undefined') {
      try { res.set('X-Filter-Ignored', 'true'); } catch {}
    }

    const enforcedScope = (!bypass && enforcedTenant)
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
        const [docsRaw, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
          SessionTracking.countDocuments(finalFilter),
        ]);

        // Ensure totals are included and preserved.
        const docs = (docsRaw || []).map(normalizeTotals);
        const envelopeTotals = computeEnvelopeTotals(docs);

        // Keep existing envelope shape but add top-level totals for UI convenience.
        const payload = {
          success: true,
          data: docs,
          meta: { page, limit, total, ...envelopeTotals },
        };

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

      const docsRaw = await SessionTracking.find(finalFilter).sort(sort).lean();
      const payload = (docsRaw || []).map(normalizeTotals);

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
router.post('/', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.create), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.put('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.update), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.delete('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.remove), async () => { try { invalidateAllSessionTrackingCache(); } catch {} });

// Keep ID read unchanged
router.get('/:id', asyncHandler(controller.getById));

module.exports = router;
