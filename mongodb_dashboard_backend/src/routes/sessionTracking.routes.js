// const express = require('express');
// const { asyncHandler } = require('../utils/http');
// const { parsePagination } = require('../utils/http');
// const SessionTracking = require('../models/sessionTracking.model');
// const { buildCrudController } = require('../controllers/crudFactory');
// const { isValidISODate, parseISODateSafe } = require('../utils/date');

// const router = express.Router();
// const controller = buildCrudController(SessionTracking, '-session_start');

// /**
//  * @swagger
//  * tags:
//  *   name: SessionTracking
//  *   description: Session tracking collection endpoints
//  */

// /**
//  * List session tracking records.
//  * Accepts: page, limit, tenant_id, start, end, filter, sort, q
//  * Filters results between session_start >= start and session_start <= end if provided.
//  * Deprecated: from, to (NO LONGER SUPPORTED -- only start/end valid).
//  */
// router.get(
//   '/',
//   asyncHandler(async (req, res) => {
//     // Resolve tenant from middleware if available; keep legacy fallbacks for safety
//     const enforcedTenant = req.tenantId ||
//       (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
//       (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
//       (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
//       (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
//       null;

//     if (!enforcedTenant) {
//       return res.status(400).json({
//         success: false,
//         message:
//           'tenant_id is required. Provide ?tenant_id=... (or header x-organization-id / x-tenant-id).',
//       });
//     }

//     // Pagination and filter logic
//     const rawQuery = { ...req.query };
//     if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
//     const { page, limit, skip, explicit } = parsePagination(rawQuery);
//     const sort = req.query.sort || '-session_start';

//     // Text search
//     const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
//     let qFilter = {};
//     if (q) {
//       const regex = new RegExp(q, 'i');
//       qFilter = {
//         $or: [
//           { task_id: regex },
//           { tenant_id: regex },
//           { organization_name: regex },
//           { user_name: regex },
//           { User_name: regex },
//           { project_id: regex },
//           { container_id: regex },
//           { service_type: regex },
//           { status: regex },
//           { user_id: regex },
//           { 'session_data.session_name': regex },
//           { 'session_data.description': regex },
//           { 'session_data.llm_model': regex },
//         ],
//       };
//     }

//     // Backwards compatible: filter (JSON or string) with tenant guard
//     const filterRaw = req.query.filter ? req.query.filter : '{}';
//     let filter = {};
//     try {
//       filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
//     } catch {
//       return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
//     }
//     // Remove legacy tenant keys (always imposed server-side)
//     if (filter && typeof filter === 'object') {
//       delete filter.organization_id;
//       delete filter.tenant_id;
//       delete filter.organizationId;
//       if (Array.isArray(filter.$or)) delete filter.$or;
//     }

//     // Tenant scoping (always $or match all possible schema fields for org/tenant)
//     const enforcedScope = enforcedTenant
//       ? {
//           $or: [
//             { tenant_id: enforcedTenant },
//             { organization_id: enforcedTenant },
//             { organizationId: enforcedTenant },
//           ],
//         }
//       : {};

//     // NEW: Accept only start/end for date filtering
//     let start = null;
//     let end = null;
//     const now = new Date();
//     const DEFAULT_WINDOW_DAYS = 30;
//     if (req.query.start || req.query.end) {
//       if (req.query.start && isValidISODate(req.query.start)) {
//         start = parseISODateSafe(req.query.start);
//       }
//       if (req.query.end && isValidISODate(req.query.end)) {
//         // The backend expects inclusive end-of-day as in previous implementation
//         const parsedEnd = parseISODateSafe(req.query.end);
//         parsedEnd.setUTCHours(23, 59, 59, 999);
//         end = parsedEnd;
//       }
//     }
//     // If either is missing, fallback to default 30d window
//     if (!start && !end) {
//       end = now;
//       start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
//     } else if (start && !end) {
//       end = now; // until now
//     } else if (!start && end) {
//       start = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
//     }
//     // Date filter applied to session_start only
//     const timeFilter = {
//       session_start: { $gte: start, $lte: end },
//     };

//     // Combine filters: base filter + search + tenant scope + time
//     const parts = [];
//     const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
//     if (!isEmpty(filter)) parts.push(filter);
//     if (!isEmpty(qFilter)) parts.push(qFilter);
//     if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
//     if (!isEmpty(timeFilter)) parts.push(timeFilter);

//     const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

//     // Ready to query
//     try {
//       if (explicit) {
//         const [docs, total] = await Promise.all([
//           SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
//           SessionTracking.countDocuments(finalFilter)
//         ]);
//         return res.json({ success: true, data: docs, meta: { page, limit, total } });
//       }

//       const docs = await SessionTracking.find(finalFilter).sort(sort);
//       return res.json(docs);
//     } catch (err) {
//       const message = err?.message || "Request failed";
//       if (err?.name === "CastError" || /Cast to/.test(message)) {
//         return res.status(400).json({ success: false, message: "Invalid value provided (list)", details: message });
//       }
//       return res.status(400).json({ success: false, message: "Request failed", details: message });
//     }
//   })
// );

// router.get('/:id', asyncHandler(controller.getById));
// router.post('/', asyncHandler(controller.create));
// router.put('/:id', asyncHandler(controller.update));
// router.delete('/:id', asyncHandler(controller.remove));

// module.exports = router;

const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

// Route-local, safe feature flags (default safe off)
const ENABLE_ROUTE_CACHE = String(process.env.ENABLE_ROUTE_CACHE || 'true').toLowerCase() === 'true';
const ENABLE_ETAG = String(process.env.ENABLE_ETAG || 'true').toLowerCase() === 'true';
const CACHE_TTL_SECONDS = Number(process.env.CACHE_TTL_SECONDS || 60);
const DEFAULT_CACHE_TTL_MS = Math.max(5, CACHE_TTL_SECONDS) * 1000;

// Minute rounding helper for stable keys
function roundToMinuteISO(value) {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

// Simple in-memory TTL cache (per-process)
const routeCache = new Map(); // key -> { expiresAt:number, payload:any, etag:string }
function cacheKeyFromReq(req, enforcedTenant) {
  // Normalize params and provide deterministic ordering
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || req.query.pageSize || 20);
  const sort = typeof req.query.sort === 'string' && req.query.sort.trim() ? req.query.sort.trim() : '-session_start';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const start = roundToMinuteISO(req.query.start || req.query.from || '');
  const end = roundToMinuteISO(req.query.end || req.query.to || '');
  const tenant = enforcedTenant ? String(enforcedTenant) : (req.tenantScopeDisabled || req.allTenants ? 'all-tenants' : 'n/a');

  // ensure stable object order by using array of pairs
  return JSON.stringify({
    route: 'GET:/api/session-tracking',
    tenant,
    page,
    limit,
    q,
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
// Invalidation hooks for CRUD operations below
function invalidateAllSessionTrackingCache() {
  let cleared = 0;
  for (const [k] of routeCache.entries()) {
    if (k.includes('GET:/api/session-tracking')) {
      routeCache.delete(k);
      cleared++;
    }
  }
  if (cleared && (process.env.NODE_ENV !== 'production')) {
    console.log(`[cache] invalidated ${cleared} keys for /api/session-tracking`);
  }
}

// Generate a strong ETag for a response body + context
function computeETag(payload, context) {
  try {
    const basis = JSON.stringify({
      ctx: context,
      // to keep hash fast but stable, include length and first/last ids when array/enveloped
      // fall back to entire payload string if not parseable
      len: Array.isArray(payload) ? payload.length : Array.isArray(payload?.data) ? payload.data.length : null,
      first: Array.isArray(payload) && payload[0]?._id ? String(payload[0]._id) : Array.isArray(payload?.data) && payload.data[0]?._id ? String(payload.data[0]._id) : null,
      last: Array.isArray(payload) && payload[payload.length - 1]?._id ? String(payload[payload.length - 1]._id) : Array.isArray(payload?.data) && payload.data[payload.data.length - 1]?._id ? String(payload.data[payload.data.length - 1]._id) : null,
      // max timestamp/updated for rough versioning if available
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

/**
 * Early bypass detector for GET /api/session-tracking
 */
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

/**
 * Diagnostic headers middleware
 */
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

    // Stable pagination and sort
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Text search (case-insensitive) - includes user_name and other fields
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let qFilter = {};
    if (q) {
      const regex = new RegExp(q, 'i');
      qFilter = {
        $or: [
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
        ],
      };
    }

    // Optional explicit user filter: userId or user_id
    // This enables narrowing by a specific user independent of q text search.
    const userId = (typeof req.query.userId === 'string' && req.query.userId.trim()) ||
                   (typeof req.query.user_id === 'string' && req.query.user_id.trim()) ||
                   null;
    const userFilter = userId ? { user_id: userId } : {};

    // Ignore client filter param; retain tenant scope + search
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

    // Default 30-day window applied to session_start. Accepts start/end.
    const DEFAULT_WINDOW_DAYS = 30;
    const now = new Date();
    let start = null;
    let end = null;
    if (req.query.start) {
      const d = new Date(req.query.start);
      if (!isNaN(d.getTime())) start = d;
    }
    if (req.query.end) {
      const d = new Date(req.query.end);
      if (!isNaN(d.getTime())) {
        // inclusive end-of-day semantics
        d.setUTCHours(23, 59, 59, 999);
        end = d;
      }
    }
    if (!start && !end) {
      end = now;
      start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    } else if (start && !end) {
      end = now;
    } else if (!start && end) {
      start = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    }
    const timeFilter = { session_start: { $gte: start, $lte: end } };

    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
    if (!isEmpty(qFilter)) parts.push(qFilter);
    if (!isEmpty(userFilter)) parts.push(userFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
    if (!isEmpty(timeFilter)) parts.push(timeFilter);
    const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

    // Prepare cache meta
    const cacheKey = cacheKeyFromReq(req, enforcedTenant);
    const wantCache = ENABLE_ROUTE_CACHE && req.method === 'GET';
    const wantETag = ENABLE_ETAG && req.method === 'GET';

    // Attempt cache read
    if (wantCache) {
      const hit = cacheGet(cacheKey);
      if (hit) {
        try {
          console.log(`[session-tracking] cache hit ${cacheKey}`);
        } catch {}
        // Handle If-None-Match
        if (wantETag) {
          const inm = req.headers['if-none-match'];
          if (inm && inm === hit.etag) {
            res.set('ETag', hit.etag);
            res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS/1000)}, must-revalidate`);
            return res.status(304).end();
          }
        }
        res.set('X-Cache', 'HIT');
        if (wantETag && hit.etag) res.set('ETag', hit.etag);
        res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS/1000)}, must-revalidate`);
        return res.status(200).json(hit.payload);
      } else {
        try {
          console.log(`[session-tracking] cache miss ${cacheKey}`);
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

        const payload = { success: true, data: docs, meta: { page, limit, total } };
        let etag = null;
        if (wantETag) {
          etag = computeETag(payload, { tenant: bypass ? 'all-tenants' : enforcedTenant, page, limit, sort, q, userId });
          res.set('ETag', etag);
        }
        res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS/1000)}, must-revalidate`);
        if (wantCache) {
          cacheSet(cacheKey, payload, etag);
        }

        // If-None-Match handling post-compute
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
      res.set('Cache-Control', `public, max-age=${Math.floor(DEFAULT_CACHE_TTL_MS/1000)}, must-revalidate`);
      if (wantCache) {
        cacheSet(cacheKey, payload, etag);
      }

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

// Hook CRUD operations to invalidate short-lived cache safely
router.post('/', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.create), async (req, res) => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.put('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.update), async (req, res) => { try { invalidateAllSessionTrackingCache(); } catch {} });
router.delete('/:id', asyncHandler(async (req, res, next) => { next(); }), asyncHandler(controller.remove), async (req, res) => { try { invalidateAllSessionTrackingCache(); } catch {} });

// Keep ID read unchanged
router.get('/:id', asyncHandler(controller.getById));

module.exports = router;
