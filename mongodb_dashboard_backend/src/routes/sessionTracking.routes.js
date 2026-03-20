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

/**
 * @swagger
 * /api/session-tracking/tenants/distinct:
 *   get:
 *     summary: List distinct tenant_id values present in session_tracking
 *     description: >
 *       Returns all distinct tenant_id values present in the session_tracking dataset.
 *       This endpoint is intended for populating UI dropdowns that need to represent the dataset,
 *       not just the authenticated user's authorized tenants list (/api/session/tenants).
 *
 *       Tenant scoping behavior:
 *       - For normal users (non-bypass): results are restricted to the enforced tenant scope.
 *       - For Super Admin in all-tenants mode (x-all-tenants=true or tenant sentinel T0000): returns distinct across all tenants.
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: header
 *         name: x-all-tenants
 *         required: false
 *         schema:
 *           type: string
 *         description: Super-admin only. When truthy, bypasses tenant scoping and returns distinct across all tenants.
 *     responses:
 *       200:
 *         description: Distinct tenant ids
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 items:
 *                   type: array
 *                   items:
 *                     type: string
 *                 total:
 *                   type: integer
 *       400:
 *         description: Bad request (missing tenant scope for non-super-admin calls)
 */
+// PUBLIC_INTERFACE
+router.get(
+  '/tenants/distinct',
+  sessionsEarlyBypassDetector,
+  asyncHandler(async (req, res) => {
+    /**
+     * DistinctTenantIdsFlow
+     *
+     * Contract:
+     * - Inputs: tenant scope inferred from existing middleware/headers/query (same as list endpoint)
+     * - Outputs: { success: true, items: string[], total: number }
+     * - Errors:
+     *   - 400 when tenant_id is required but not present (non-super-admin, non-bypass)
+     * - Side effects: none
+     */
+    const bypass = !!(
+      req.tenantScopeDisabled ||
+      req.allTenants ||
+      req.sessionsAllTenantsBypass ||
+      req?.user?.isSuperAdmin
+    );
+
+    const enforcedTenantRaw =
+      req.tenantId ||
+      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
+      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
+      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
+      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
+      null;
+
+    const enforcedTenant = enforcedTenantRaw ? String(enforcedTenantRaw).trim() : null;
+
+    if (!bypass && !enforcedTenant) {
+      return res.status(400).json({
+        success: false,
+        message: 'tenant_id is required. Provide ?tenant_id=...'
+      });
+    }
+
+    // Defense in depth: never enforce a literal scope for the all-tenants sentinel.
+    const match = (!bypass && enforcedTenant && !isAllTenantsSentinel(enforcedTenant))
+      ? {
+          $or: [
+            { tenant_id: enforcedTenant },
+            { organization_id: enforcedTenant },
+            { organizationId: enforcedTenant },
+          ],
+        }
+      : {};
+
+    // Distinct over both possible fields, then normalize to a single tenant id set.
+    const pipeline = [
+      ...(Object.keys(match).length ? [{ $match: match }] : []),
+      {
+        $project: {
+          _t: {
+            $ifNull: [
+              '$tenant_id',
+              { $ifNull: ['$organization_id', '$organizationId'] }
+            ]
+          }
+        }
+      },
+      { $match: { _t: { $type: 'string', $ne: '' } } },
+      { $group: { _id: '$_t' } },
+      { $sort: { _id: 1 } },
+    ];
+
+    const docs = await SessionTracking.aggregate(pipeline);
+    const items = (docs || [])
+      .map((d) => (d && d._id != null ? String(d._id).trim() : ''))
+      .filter((v) => !!v);
+
+    return res.status(200).json({ success: true, items, total: items.length });
+  })
+);
+
+router.get(
+  '/',
+  sessionsEarlyBypassDetector,
+  asyncHandler(async (req, res) => {
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
    if (userId) {
      // Exact equality on user_id
      searchFilter = { user_id: userId };
    } else if (q) {
      /**
       * Make q-search resilient and safe for multi-word names.
       *
       * Key invariant:
       * - q is treated as literal text, not as a regex program.
       *   (We escape regex metacharacters to avoid slow/unsafe patterns.)
       *
       * Also:
       * - Multi-word q is matched with whitespace-tolerant pattern across fields,
       *   and an AND-of-tokens matcher for user_name fields.
       */
      const qTrimmed = q.trim();

      // Guardrail: avoid extremely long q creating huge regex scans.
      // This endpoint can scan many fields (and with T0000 can scan across all tenants).
      const MAX_Q_LENGTH = Number(process.env.SESSION_TRACKING_MAX_Q_LENGTH || 128);
      if (qTrimmed.length > MAX_Q_LENGTH) {
        return res.status(400).json({
          success: false,
          message: `q is too long (max ${MAX_Q_LENGTH} characters)`,
        });
      }

      // Safe "phrase" regex: literal tokens joined by \s+ so "Aditi S" matches "Aditi  S".
      const phraseRegex = buildSafePhraseRegex(qTrimmed);

      // Single token: allow exact user_id equality fast-path.
      const looksLikeId = !/\s/.test(qTrimmed);

      const orParts = [
        { task_id: phraseRegex },
        { tenant_id: phraseRegex },
        { organization_name: phraseRegex },
        { user_name: phraseRegex },
        { User_name: phraseRegex },
        { project_id: phraseRegex },
        { container_id: phraseRegex },
        { service_type: phraseRegex },
        { status: phraseRegex },
        { user_id: phraseRegex },
        { 'session_data.session_name': phraseRegex },
        { 'session_data.description': phraseRegex },
        { 'session_data.llm_model': phraseRegex },
      ];

      if (looksLikeId) {
        orParts.unshift({ user_id: qTrimmed });
      } else {
        // Tokenize on whitespace; ignore empty tokens.
        const tokens = qTrimmed.split(/\s+/).map((t) => t.trim()).filter(Boolean);

        if (tokens.length >= 2) {
          // Token regexes are literal-safe too.
          const tokenRegexes = tokens.map((t) => new RegExp(escapeRegexLiteral(t), 'i'));

          // Match either user_name or User_name where *all* tokens match (in any order).
          const userNameAllTokens = {
            $and: tokenRegexes.map((r) => ({ user_name: r })),
          };
          const userNameAllTokensAlt = {
            $and: tokenRegexes.map((r) => ({ User_name: r })),
          };

          orParts.unshift({ $or: [userNameAllTokens, userNameAllTokensAlt] });
        }
      }

      searchFilter = { $or: orParts };
    }

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
            q,
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
