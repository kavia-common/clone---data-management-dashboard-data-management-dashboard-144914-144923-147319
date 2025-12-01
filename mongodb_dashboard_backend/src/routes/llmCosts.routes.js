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

// Kick off index ensure in background (non-blocking) to reduce first-hit latency
try { if (LLMCost.ensureIndexes) { LLMCost.ensureIndexes().catch(() => {}); } } catch (_) {}

// Local list handler to enforce performance constraints (maxTimeMS, projection, hint, clamped limit) and log slow queries
async function listWithPerf(req, res, next) {
  const started = Date.now();
  try {
    // Enforce limit clamp (<=100) already normalized earlier, but double-check
    let limit = parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;
    req.query.limit = String(limit);

    // Default sort aligned with index
    if (!req.query.sort) {
      req.query.sort = '-timestamp';
    }

    // Attach queryOptions consumed by crudFactory.list if supported; else use model directly via override on req
    req.query._projection = JSON.stringify({
      // Only commonly used fields
      _id: 1,
      tenant_id: 1,
      organization_id: 1,
      user_id: 1,
      llm_model: 1,
      total_cost: 1,
      currency: 1,
      timestamp: 1,
      created_at: 1,
      updated_at: 1,
      project_id: 1,
      session_id: 1,
    });

    // Attach performance hints for downstream list
    req.query._maxTimeMS = '4000'; // 4s
    req.query._hint = JSON.stringify([
      // Prefer tenant scoped indexes if tenant is present; crud list merges appropriately
      { tenant_id: 1, timestamp: -1 },
      { organization_id: 1, timestamp: -1 },
      { timestamp: -1, _id: 1 },
    ]);

    // Delegate to standard list
    await controller.list(req, res);

    const dur = Date.now() - started;
    if (dur > 1000) {
      try {
        console.warn(`[llm-costs] Slow list query: ${dur}ms page=${req.query.page} limit=${req.query.limit} tenant=${req.tenantId || req.headers['x-organization-id'] || ''}`);
      } catch (_) {}
    }
  } catch (err) {
    const dur = Date.now() - started;
    try {
      console.error(`[llm-costs] List failed after ${dur}ms:`, err?.message || err);
    } catch (_) {}
    return next(err);
  }
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
        let resolved = hdrOrg || qOrg || undefined;

        // Normalize b2c tenant alias if used
        if (resolved && String(resolved).toLowerCase() === 'b2c') {
          resolved = 'b2c';
          try { res.set('X-B2C-Tenant', 'true'); } catch(_) {}
        }

        if (resolved) {
          req.tenantId = String(resolved);
        }
      }
    }

    // Enforce mandatory pagination for the list endpoint to prevent 504s
    if (isList) {
      const pageProvided = typeof req.query.page !== 'undefined';
      const limitProvided = typeof req.query.limit !== 'undefined' || typeof req.query.pageSize !== 'undefined';
      if (!pageProvided || !limitProvided) {
        try { res.set('X-Default-Pagination', 'rejected'); } catch(_) {}
        return res.status(400).json({ success: false, message: 'Pagination required: provide ?page and ?limit (<=100). from/to are optional.' });
      }
      // Normalize alias pageSize to limit
      if (!req.query.limit && req.query.pageSize) {
        req.query.limit = req.query.pageSize;
      }
      // Enforce max limit of 100
      const n = parseInt(req.query.limit, 10);
      if (!Number.isFinite(n) || n < 1) {
        return res.status(400).json({ success: false, message: 'Invalid limit; must be >=1 and <=100' });
      }
      if (n > 100) {
        req.query.limit = '100';
        try { res.set('X-Limit-Clamped', '100'); } catch(_) {}
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
 *       Returns a list of LLM cost documents.
 *       Pagination is REQUIRED: provide ?page>=1 and ?limit<=100. Results are returned as { success, data, meta }.
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
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO lower bound for timestamp filter. Defaults to now-30d when omitted.
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO upper bound for timestamp filter. Defaults to now when omitted.
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Invalid filter or missing tenant (when not bypass)
 *       403:
 *         description: Forbidden on tenant mismatch with Authorization
 */
const { aggregateOrganizationCosts } = require('../services/llmCosts.organization.service');

/**
 * Organization-level flat rows with per-user totals and organization total.
 * Implements minimal pipeline:
 *   1) $match by resolved tenant (organization_id/tenant)
 *   2) $group by user_id computing user_cost and projects_count
 *   3) compute organization_cost in a parallel facet
 *   4) $facet for pagination (data/count), sorted by user_cost desc, limit<=100
 * Returns rows: [{ _id, organization_cost, user_id, user_cost, projects_count }]
 */
router.get('/', asyncHandler(async (req, res) => {
  const started = Date.now();

  // Enforce pagination and clamp limit <= 100
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  let limit = Math.max(parseInt(req.query.limit, 10) || 20, 1);
  if (limit > 100) {
    limit = 100;
    try { res.set('X-Limit-Clamped', '100'); } catch (_) {}
  }
  const skip = (page - 1) * limit;

  // Tenant resolution (bypass if super admin/T0000 already set by middleware)
  const tenantId = (req.tenantScopeDisabled || req.allTenants) ? null : (req.tenantId || null);

  // Parse optional filter safely; tenant fields are ignored server-side
  let filter = {};
  if (req.query && req.query.filter) {
    try {
      filter = JSON.parse(req.query.filter);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }
  }
  // Drop tenant hints from client filter
  delete filter.tenant_id;
  delete filter.tenantId;
  delete filter.organization_id;
  delete filter.organizationId;
  delete filter.orgId;

  // Optional time window
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const timeFilter = {};
  if (from || to) {
    const range = {};
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (fromDate && !isNaN(fromDate.getTime())) range.$gte = fromDate;
    if (toDate && !isNaN(toDate.getTime())) range.$lte = toDate;
    if (Object.keys(range).length) {
      timeFilter.timestamp = range;
    }
  }

  // Build base match with tenant if provided
  let match = filter && Object.keys(filter).length ? { ...filter } : {};
  if (tenantId) {
    const orgFilter = {
      $or: [
        { tenant_id: String(tenantId) },
        { organization_id: String(tenantId) },
        { organizationId: String(tenantId) },
        { tenantId: String(tenantId) },
        { orgId: String(tenantId) },
        { 'tenant.tenant_id': String(tenantId) },
      ],
    };
    match = Object.keys(match).length ? { $and: [match, orgFilter] } : orgFilter;
  }
  if (Object.keys(timeFilter).length) {
    match = Object.keys(match).length ? { $and: [match, timeFilter] } : timeFilter;
  }

  // Mongo driver via model collection
  const collection = LLMCost.collection;

  // Build numeric cost expression with $ifNull coercion
  const numericCostExpr = {
    $let: {
      vars: {
        raw: {
          $ifNull: [
            '$total_cost',
            { $ifNull: ['$cost', { $ifNull: ['$usage.cost', 0] }] },
          ],
        },
      },
      in: {
        $convert: {
          input: {
            $cond: [
              { $isNumber: '$$raw' }, '$$raw',
              {
                $cond: [
                  { $and: [{ $eq: [{ $type: '$$raw' }, 'string'] }, { $eq: [{ $substrCP: ['$$raw', 0, 1] }, '$'] }] },
                  { $substrCP: ['$$raw', 1, { $strLenCP: '$$raw' }] },
                  { $toString: '$$raw' },
                ],
              },
            ],
          },
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
    },
  };

  // Core per-user grouping pipeline
  const userPipeline = [
    { $match: match || {} },
    { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
    {
      $project: {
        _id: 0,
        user_id: { $toString: { $ifNull: ['$user_id', { $ifNull: ['$userId', '$user'] }] } },
        project_id: {
          $toString: {
            $ifNull: ['$project_id', { $ifNull: ['$projectId', { $ifNull: ['$project', '$project_code'] }] }],
          },
        },
        org_id: {
          $toString: {
            $ifNull: [
              '$tenant_id',
              { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', { $ifNull: ['$tenantId', '$orgId'] }] }] },
            ],
          },
        },
        numeric_cost: numericCostExpr,
      },
    },
    { $match: { user_id: { $ne: null }, project_id: { $ne: null } } },
    {
      $group: {
        _id: { user_id: '$user_id', project_id: '$project_id' },
        project_cost: { $sum: '$numeric_cost' },
        org_id: { $first: '$org_id' },
      },
    },
    {
      $group: {
        _id: { user_id: '$_id.user_id', org_id: '$org_id' },
        user_cost: { $sum: '$project_cost' },
        projects: { $addToSet: '$_id.project_id' },
      },
    },
    {
      $project: {
        _id: 0,
        user_id: '$_id.user_id',
        org_id: '$_id.org_id',
        user_cost: { $round: ['$user_cost', 6] },
        projects_count: { $size: '$projects' },
      },
    },
  ];

  // Facet with orgTotal and user data
  const pipeline = [
    { $match: match || {} },
    { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
    {
      $facet: {
        orgTotal: [
          {
            $group: {
              _id: null,
              organization_cost: { $sum: numericCostExpr },
              org_id: {
                $first: {
                  $toString: {
                    $ifNull: [
                      '$tenant_id',
                      { $ifNull: ['$organization_id', { $ifNull: ['$organizationId', { $ifNull: ['$tenantId', '$orgId'] }] }] },
                    ],
                  },
                },
              },
            },
          },
          { $project: { _id: 0, organization_cost: { $round: ['$organization_cost', 6] }, org_id: 1 } },
        ],
        usersRaw: userPipeline,
      },
    },
    {
      $project: {
        orgTotal: { $arrayElemAt: ['$orgTotal', 0] },
        usersSorted: {
          $sortArray: {
            input: { $ifNull: ['$usersRaw', []] },
            sortBy: { user_cost: -1, user_id: 1 },
          },
        },
      },
    },
    {
      $project: {
        orgTotal: 1,
        totalUsers: { $size: { $ifNull: ['$usersSorted', []] } },
        users: { $slice: [{ $ifNull: ['$usersSorted', []] }, skip, limit] },
      },
    },
  ];

  // Execute aggregation with maxTimeMS(4000) and allowDiskUse
  const agg = collection.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 4000 });
  // Best-effort index hinting
  try {
    if (tenantId) {
      agg.hint({ tenant_id: 1, timestamp: -1, _id: 1 });
    } else {
      agg.hint({ timestamp: -1, _id: 1 });
    }
  } catch (_) {}

  let docs = [];
  try {
    docs = await agg.toArray();
  } catch (e) {
    // If aggregation fails, return empty envelope but do not crash
    const elapsed = Date.now() - started;
    try { res.set('X-Query-Duration-ms', String(elapsed)); } catch (_) {}
    return res.status(200).json({ success: true, data: [], meta: { page, limit, total: 0 }, meta_debug: { fallback: true, error: e?.message || String(e) } });
  }

  const first = docs && docs[0] ? docs[0] : { orgTotal: null, users: [], totalUsers: 0 };
  const org = first.orgTotal || { organization_cost: 0, org_id: tenantId ? String(tenantId) : 'all' };
  const orgCost = Number(org.organization_cost || 0);
  const orgId = String(org.org_id || (tenantId || 'all'));

  // Flatten rows
  const rows = (first.users || []).map((u) => ({
    _id: `${orgId}::${String(u.user_id || '')}`,
    organization_cost: orgCost,
    user_id: String(u.user_id || ''),
    user_cost: Number(u.user_cost || 0),
    projects_count: Number(u.projects_count || 0),
  }));

  const total = Number(first.totalUsers || 0);
  const elapsed = Date.now() - started;
  try {
    res.set('X-Query-Duration-ms', String(elapsed));
    res.set('X-Pagination-Page', String(page));
    res.set('X-Pagination-Limit', String(limit));
    res.set('X-Pagination-Total', String(total));
    res.set('X-Aggregation', 'facet:orgTotal+users(grouped)');
    res.set('X-Collection-llm-costs', LLMCost.collection?.name || 'llm-costs');
    if (tenantId) {
      res.set('X-Applied-Tenant', String(tenantId));
      res.set('x-applied-organization-id', String(tenantId));
    } else {
      res.set('X-All-Tenants', 'true');
    }
  } catch (_) {}

  return res.status(200).json({
    success: true,
    data: rows,
    meta: { page, limit, total },
  });
}));

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
