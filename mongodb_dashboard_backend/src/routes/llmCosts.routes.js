'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement.
 */
const router = express.Router();
/**
 * Use safe default sort on indexed field 'timestamp' in descending order.
 * Sorting by '-timestamp' benefits from index { tenant_id:1, timestamp:-1 } on the model.
 */
const controller = buildCrudController(LLMCost, '-timestamp'); // default indexed sort

/**
 * Build safe, indexed filter with tenant enforcement and optional search fields.
 * - organization/tenant is REQUIRED unless bypass enabled (T0000).
 * - supports optional date range: from,to over timestamp/created_at.
 * - whitelisted fields for filtering: status, provider, llm_model, user_id, session_id, project_id, request_id
 */
function buildIndexedFilter(req) {
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);

  // Parse filter JSON if present
  let clientFilter = {};
  if (typeof req.query.filter === 'string' && req.query.filter.trim() !== '') {
    try {
      clientFilter = JSON.parse(req.query.filter);
    } catch {
      throw Object.assign(new Error('Invalid filter JSON'), { statusCode: 400 });
    }
  }

  // scrub tenant hints from client filter
  delete clientFilter.tenant_id;
  delete clientFilter.tenantId;
  delete clientFilter.organization_id;
  delete clientFilter.organizationId;
  delete clientFilter['tenant.tenant_id'];

  // Build enforced tenant filter
  let enforcedTenantMatch = {};
  if (!bypass) {
    const tenantId = req?.tenantId || req?.organizationId || (req?.auth?.tenantId ? String(req.auth.tenantId) : undefined);
    if (!tenantId) {
      const err = new Error('Missing tenant (organization_id). Provide Authorization or x-organization-id header.');
      err.statusCode = 400;
      throw err;
    }
    const t = String(tenantId);
    enforcedTenantMatch = {
      $or: [
        { tenant_id: t },
        { organization_id: t },
        { organizationId: t },
        { tenantId: t },
        { 'tenant.tenant_id': t },
      ],
    };
  }

  // Optional from/to date range
  let dateMatch = {};
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  if (from || to) {
    const ts = {};
    if (from && !isNaN(from)) ts.$gte = from;
    if (to && !isNaN(to)) ts.$lte = to;
    dateMatch = {
      $or: [
        { timestamp: ts },
        { created_at: ts },
      ],
    };
  }

  // Whitelist simple equality fields
  const allow = ['status', 'provider', 'llm_model', 'user_id', 'session_id', 'project_id', 'request_id'];
  const simple = {};
  for (const key of allow) {
    if (clientFilter[key] != null) simple[key] = clientFilter[key];
  }

  // Merge as $and components to preserve index usage
  const andParts = [];
  if (Object.keys(enforcedTenantMatch).length) andParts.push(enforcedTenantMatch);
  if (Object.keys(simple).length) andParts.push(simple);
  if (Object.keys(dateMatch).length) andParts.push(dateMatch);

  // Any remaining complex client filters (e.g., $or on whitelisted keys)
  const remainingKeys = Object.keys(clientFilter).filter((k) => !allow.includes(k));
  if (remainingKeys.length) {
    // Ignore non-whitelisted keys to avoid unindexed scans
    // Optionally, we could add support for regex search on request_id etc.
  }

  const finalFilter = andParts.length ? { $and: andParts } : {};
  return finalFilter;
}

/**
 * Projection for tabular-friendly listing response.
 * Only include columns needed by the UI table to reduce payload and speed up query.
 */
const listProjection = {
  _id: 1,
  timestamp: 1,
  created_at: 1,
  llm_model: 1,
  provider: 1,
  user_id: 1,
  organization_id: 1,
  tenant_id: 1,
  session_id: 1,
  project_id: 1,
  request_id: 1,
  status: 1,
  total_cost: 1,
  currency: 1,
  'usage.tokens_input': 1,
  'usage.tokens_output': 1,
  tokens_in: 1,
  tokens_out: 1,
  duration_ms: 1,
};

/**
 * Normalize a document to the required tabular fields.
 */
function mapToTabular(doc) {
  const tokensIn = doc?.usage?.tokens_input ?? doc?.tokens_in ?? doc?.input_tokens ?? null;
  const tokensOut = doc?.usage?.tokens_output ?? doc?.tokens_out ?? doc?.output_tokens ?? null;

  // ensure numeric cost
  let cost = doc?.total_cost;
  if (typeof cost === 'string') {
    const sanitized = cost.replace(/[$,]/g, '');
    const num = Number(sanitized);
    cost = Number.isFinite(num) ? num : null;
  } else if (typeof cost !== 'number') {
    cost = Number(cost);
    if (!Number.isFinite(cost)) cost = null;
  }

  return {
    _id: String(doc?._id || ''),
    request_id: doc?.request_id ?? doc?.requestId ?? null,
    timestamp: doc?.timestamp || doc?.created_at || null,
    model: doc?.llm_model || doc?.model || null,
    provider: doc?.provider || null,
    user_id: doc?.user_id != null ? String(doc.user_id) : null,
    organization_id: doc?.tenant_id || doc?.organization_id || null,
    tokens_in: tokensIn != null ? Number(tokensIn) : null,
    tokens_out: tokensOut != null ? Number(tokensOut) : null,
    cost_usd: cost,
    duration_ms: doc?.duration_ms != null ? Number(doc.duration_ms) : null,
    status: doc?.status || null,
  };
}

/**
 * Apply core auth+tenant middleware but allow route-local resolver to set tenantId for demo/preview calls
 * where Authorization may be missing and organization_id is provided as query/header.
 */
router.use(verifyAuth, requireTenant, tenantScopeEnforcer());

/**
 * Route-local resolver: for GET /api/llm-costs (list) allow resolving tenant
 * from x-organization-id or ?organization_id/?tenant_id when req.tenantId is not set.
 * Mirrors behavior of /api/users.
 */
router.use((req, res, next) => {
  try {
    const isList = req.method === 'GET' && (req.path === '/' || req.path === '');
    const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);

    if (isList && !bypass) {
      // If verifyAuth/requireTenant didn't resolve tenantId, accept aliases
      if (!req.tenantId) {
        const hdrOrg =
          (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
          (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
          (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
          undefined;
        const qOrg =
          (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
          (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
          undefined;
        const resolved = hdrOrg || qOrg || undefined;
        if (resolved) {
          req.tenantId = String(resolved);
        }
      }
    }

    // Diagnostics headers similar to users route
    try {
      if (req.tenantScopeDisabled || req.allTenants) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (req.tenantId) {
        const t = String(req.tenantId);
        res.set('X-Applied-Tenant', t);
        res.set(
          'X-Applied-Filter',
          JSON.stringify({
            $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }],
          })
        );
      }
      try { res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs'); } catch (_) {}
    } catch (_) {}
  } catch (_) {
    // non-fatal
  }
  next();
});

/**
 * Super Admin and T0000 bypass (route-local, consistent with users route)
 */
router.use((req, res, next) => {
  try {
    const hdr = (req.headers?.['x-organization-id'] || '').toString();
    const qOrg = (req.query?.organization_id || req.query?.tenant_id || '').toString();
    const authTenant = (req.auth?.tenantId || req.tenantId || '').toString();
    const requestedTenant = hdr || qOrg || authTenant || '';
    const isT0000 = requestedTenant && /^T0+$/i.test(requestedTenant);

    if (isT0000) {
      req.tenantScopeDisabled = true;
      req.allTenants = true;
      req.costsAllTenantsBypass = true;
      try {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } catch (_) {}
      console.log('[llmCosts.routes] SuperAdmin/T0000 bypass applied', {
        inputs: { hdr, qOrg, authTenant },
        requestedTenant,
        isT0000,
      });
    } else {
      console.log('[llmCosts.routes] bypass not applied', {
        inputs: { hdr, qOrg, authTenant },
        requestedTenant,
        isT0000,
      });
    }
  } catch (e) {
    // non-fatal
  }
  next();
});

/**
 * Diagnostics header injector
 */
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
        JSON.stringify({
          $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }],
        })
      );
    }
    try { res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs'); } catch (_) {}
  } catch (_) {}
  next();
});

/**
 * @swagger
 * tags:
 *   name: LLMCosts
 *   description: LLM usage cost records endpoints
 */

/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List LLM cost records
 *     description: |
 *       Returns a list of LLM cost documents. Supports optional JSON filter, sorting and pagination.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned.
 *       Tenant scoping: When Authorization is present, JWT tenant is enforced and overrides header/query. If a different organization_id/tenant_id is provided than the JWT tenant, the request is rejected with 403.
 *       In demo mode without JWT, x-organization-id header or query aliases (?tenant_id/organization_id) can be used to set scope.
 *       The server ignores any tenant fields in the filter and injects the resolved tenant internally.
 *       Sorting does not require a timestamp field; it defaults safely to -timestamp if provided or allowed.
 *       Currency and numeric parsing: documents may contain currency strings (e.g., \"$1.23\"). Server-side aggregation
 *       and clients defensively coerce to numbers where needed. Prefer storing total_cost as a number.
 *     tags: [LLMCosts]
 *     operationId: listLlmCosts
 *     parameters:
 *       - in: header
 *         name: x-organization-id
 *         schema: { type: string }
 *         required: false
 *         description: Tenant (organization) ID when JWT is not present.
 *       - in: query
 *         name: organization_id
 *         schema: { type: string }
 *       - in: query
 *         name: tenant_id
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Allowed values include: timestamp, created_at, _id (prefix with '-' for desc). Default -timestamp.
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: Optional JSON filter; tenant fields are ignored server-side.
 *     responses:
 *       200:
 *         description: Tabular-friendly envelope response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id: { type: string, description: "Document id" }
 *                       request_id: { type: string, nullable: true }
 *                       timestamp: { type: string, format: date-time, nullable: true }
 *                       model: { type: string, nullable: true }
 *                       provider: { type: string, nullable: true }
 *                       user_id: { type: string, nullable: true }
 *                       organization_id: { type: string, nullable: true }
 *                       tokens_in: { type: integer, nullable: true }
 *                       tokens_out: { type: integer, nullable: true }
 *                       cost_usd: { type: number, nullable: true }
 *                       duration_ms: { type: integer, nullable: true }
 *                       status: { type: string, nullable: true }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     limit: { type: integer }
 *                     total: { type: integer }
 *                     sort: { type: string }
 *       400:
 *         description: Invalid filter or missing tenant (when not bypass)
 *       403:
 *         description: Forbidden on tenant mismatch with Authorization
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Adds:
 * - Request-level timeout (default 12s, configurable via LLM_COSTS_ROUTE_TIMEOUT_MS)
 * - Default date window if client does not request pagination and no explicit date filter is provided (last 30 days)
 *   Applied on normalized timestamp: { $ifNull: ['$timestamp', '$created_at'] }
 * - Defensive error handling to avoid upstream 504s by responding with 408 on handler timeout
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const DEFAULT_TIMEOUT_MS = parseInt(process.env.LLM_COSTS_ROUTE_TIMEOUT_MS || '12000', 10);
    const DEFAULT_PAGE_LIMIT = Math.min(
      Math.max(parseInt(process.env.DEFAULT_PAGE_LIMIT || '50', 10), 1),
      200
    );

    // Route-level timeout guard
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        try { res.set('X-Server-Timeout', String(DEFAULT_TIMEOUT_MS)); } catch (_) {}
        return res.status(408).json({
          success: false,
          message: 'Request timed out while processing LLM costs. Apply pagination or date filters.',
        });
      }
    }, DEFAULT_TIMEOUT_MS);

    try {
      // Determine pagination
      const page = Math.max(parseInt(req.query.page || '1', 10), 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit || String(DEFAULT_PAGE_LIMIT), 10), 1), 200);
      const skip = (page - 1) * limit;

      // Build safe filter
      const filter = buildIndexedFilter(req);

      // Enforce safe sort on indexed fields
      const allowedSorts = new Set(['timestamp', 'created_at', '_id', 'total_cost']);
      const sortStr = typeof req.query.sort === 'string' ? req.query.sort.trim() : '-timestamp';
      const sortField = sortStr.replace(/^-/, '');
      const sortDir = sortStr.startsWith('-') ? -1 : 1;
      const sort = allowedSorts.has(sortField) ? { [sortField]: sortDir } : { timestamp: -1 };
      if (!allowedSorts.has(sortField)) {
        try { res.set('X-Forced-Sort', 'timestamp'); } catch (_) {}
      }

      // Default 30-day window if client didn't specify date range to avoid full scan
      const hasDate = !!(req.query.from || req.query.to);
      if (!hasDate) {
        const now = new Date();
        const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const defaultDate = { $or: [{ timestamp: { $gte: from, $lte: now } }, { created_at: { $gte: from, $lte: now } }] };
        if (Object.keys(filter).length) {
          if (!filter.$and) filter.$and = [];
          filter.$and.push(defaultDate);
        } else {
          Object.assign(filter, defaultDate);
        }
        try { res.set('X-Default-Date-Window', 'last-30-days'); } catch (_) {}
      }

      // Query with projection and lean
      const q = LLMCost.find(filter, listProjection).sort(sort).skip(skip).limit(limit).lean();

      // Hint to use tenant+timestamp index if possible
      try {
        if (filter.$and?.some((c) => c.$or)) {
          // If tenant enforced via $or, still add a reasonable hint on timestamp
          q.hint({ timestamp: -1 });
        } else if (filter.tenant_id) {
          q.hint({ tenant_id: 1, timestamp: -1 });
        }
      } catch (_) {}

      const [items, total] = await Promise.all([
        q.exec(),
        LLMCost.countDocuments(filter),
      ]);

      if (timedOut) return;

      const data = Array.isArray(items) ? items.map(mapToTabular) : [];
      const envelope = {
        success: true,
        data,
        meta: {
          page,
          limit,
          total,
          sort: sortStr,
        },
      };

      // Diagnostics headers
      try {
        res.set('X-Query-Filter', JSON.stringify(filter));
        res.set('X-Projection', 'tabular-v1');
        res.set('X-Collection', LLMCost.collection?.name || 'llm-costs');
      } catch (_) {}

      return res.status(200).json(envelope);
    } catch (err) {
      const status = err?.statusCode || 500;
      return res.status(status).json({ success: false, message: err?.message || 'Internal server error' });
    } finally {
      clearTimeout(timer);
    }
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
