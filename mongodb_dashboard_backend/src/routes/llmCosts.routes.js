'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer');
const LLMCost = require('../models/llmCosts.model');
const mongoose = require('mongoose');

/**
 * PUBLIC_INTERFACE
 * LLMCosts Router
 * Exposes CRUD endpoints with tenant enforcement.
 */
const router = express.Router();

/**
 * Whitelist of allowed sortable fields to avoid unindexed or unsafe sorts.
 */
const SORT_WHITELIST = new Set(['timestamp', 'created_at', '_id', 'total_cost']);

/**
 * Parse sort string like "-timestamp" or "created_at" into Mongoose sort object.
 * Falls back to -timestamp when invalid or not allowed.
 */
function parseSort(sortStr) {
  const raw = (sortStr || '').toString().trim();
  if (!raw) return { timestamp: -1 };
  let dir = 1;
  let field = raw;
  if (raw.startsWith('-')) {
    dir = -1;
    field = raw.substring(1);
  }
  if (!SORT_WHITELIST.has(field)) return { timestamp: -1 };
  return { [field]: dir };
}

/**
 * Parse JSON filter defensively. Returns {} on error.
 * Tenant fields are stripped; caller injects tenant criterion separately.
 */
function parseFilter(filterStr) {
  if (!filterStr || typeof filterStr !== 'string') return {};
  try {
    const f = JSON.parse(filterStr);
    if (!f || typeof f !== 'object') return {};
    delete f.tenant_id;
    delete f.tenantId;
    delete f.organization_id;
    delete f.organizationId;
    delete f.orgId;
    delete f['tenant.tenant_id'];
    return f;
  } catch {
    return { __invalidFilter: true };
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
 *         description: OK
 *       400:
 *         description: Invalid filter or missing tenant (when not bypass)
 *       403:
 *         description: Forbidden on tenant mismatch with Authorization
 */
/**
 * PUBLIC_INTERFACE
 * GET /api/llm-costs
 * Fast list with tenant scoping, pagination defaults, safe sorting, and projection.
 * - Returns 200 with envelope when page/limit provided, else raw array (up to safe cap).
 * - Returns 204 when no data quickly.
 */
router.get('/', asyncHandler(async (req, res) => {
  // Resolve tenant and T0000 bypass
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
  let tenant = req.tenantId || req?.auth?.tenantId || null;

  // If Authorization present and client provided tenant different from JWT tenant, reject (unless bypass)
  if (!bypass && req.headers?.authorization) {
    const clientRequestedTenant =
      (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      '';
    if (clientRequestedTenant && tenant && String(clientRequestedTenant) !== String(tenant)) {
      return res.status(403).json({ success: false, message: 'Forbidden: tenant scope mismatch' });
    }
  }

  // Apply T0000 header/query bypass
  try {
    const hinted = (req.headers?.['x-organization-id'] || req.query?.organization_id || req.query?.tenant_id || '').toString();
    if (hinted && /^T0+$/i.test(hinted)) {
      tenant = null;
    }
  } catch {}

  // Parse query params
  const page = Math.max(1, parseInt(req.query?.page || '1', 10) || 1);
  const limitRaw = parseInt(req.query?.limit || '10', 10);
  const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));
  const envelope = !!(req.query?.page || req.query?.limit);
  const sort = parseSort(req.query?.sort);

  // Filter
  const filterParsed = parseFilter(req.query?.filter);
  if (filterParsed.__invalidFilter) {
    return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
  }

  // Build Mongo filter with tenant
  let mongoFilter = { ...filterParsed };
  if (!bypass && tenant) {
    const t = String(tenant);
    mongoFilter = Object.keys(mongoFilter).length
      ? { $and: [mongoFilter, { $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }] }] }
      : { $or: [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }] };
  }

  // Projection to reduce payload size for list; include common fields
  const projection = {
    tenant_id: 1,
    organization_id: 1,
    user_id: 1,
    llm_model: 1,
    provider: 1,
    service_type: 1,
    operation: 1,
    total_cost: 1,
    currency: 1,
    timestamp: 1,
    created_at: 1,
  };

  // Query with abort signal timeout to prevent long hangs
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15s safety
  try {
    const query = LLMCost.find(mongoFilter, projection, { signal: controller.signal })
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit);

    // Hint index when sorting by timestamp with tenant filter to speed up
    try {
      if (sort.timestamp && sort.timestamp !== 0 && !bypass && tenant) {
        query.hint({ tenant_id: 1, timestamp: -1 });
      }
    } catch {}

    const docs = await query.lean().exec();

    // Set diagnostics headers
    try {
      res.set('X-Model-Collection', LLMCost.collection?.name || 'llm-costs');
      if (bypass) {
        res.set('X-All-Tenants', 'true');
        res.set('X-Applied-Tenant', 'all-tenants');
      } else if (tenant) {
        res.set('X-Applied-Tenant', String(tenant));
      }
    } catch {}

    if (!docs || docs.length === 0) {
      return res.status(204).send();
    }

    if (envelope) {
      // Lightweight total: avoid full count with heavy filters by limiting to estimated count when possible
      // Try fast count; if it errors or times out, fall back to docs.length as a conservative value
      let total = docs.length;
      try {
        const countController = new AbortController();
        const countTimeout = setTimeout(() => countController.abort(), 3000); // 3s cap
        total = await LLMCost.countDocuments(mongoFilter, { signal: countController.signal }).exec();
        clearTimeout(countTimeout);
      } catch {
        // keep fallback
      }
      return res.status(200).json({
        success: true,
        data: docs,
        meta: { page, limit, total },
      });
    }

    return res.status(200).json(docs);
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      return res.status(503).json({ success: false, message: 'Query timeout' });
    }
    // Map common cast errors to 400
    if (err && err.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid query parameter' });
    }
    // Generic failure
    return res.status(500).json({ success: false, message: 'Internal Server Error' });
  } finally {
    clearTimeout(timeout);
  }
}));

// Keep ID-based routes simple via Mongoose, with tenant check if applicable
router.get('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }

  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
  const tenant = req.tenantId || req?.auth?.tenantId || null;

  const filter = { _id: id };
  if (!bypass && tenant) {
    const t = String(tenant);
    filter.$or = [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }];
  }

  const doc = await LLMCost.findOne(filter).lean().exec();
  if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
  return res.status(200).json(doc);
}));

router.post('/', asyncHandler(async (req, res) => {
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
  let payload = req.body && typeof req.body === 'object' ? { ...req.body } : {};
  if (!bypass) {
    const tenant = req.tenantId || req?.auth?.tenantId || null;
    if (!tenant) return res.status(400).json({ success: false, message: 'Missing tenant' });
    if (!('tenant_id' in payload)) payload.tenant_id = String(tenant);
  }
  try {
    const created = await LLMCost.create(payload);
    return res.status(201).json(created);
  } catch (e) {
    if (e && e.name === 'ValidationError') {
      return res.status(422).json({ success: false, message: 'Validation failed', details: e.errors });
    }
    return res.status(400).json({ success: false, message: e?.message || 'Bad request' });
  }
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
  const tenant = req.tenantId || req?.auth?.tenantId || null;
  const filter = { _id: id };
  if (!bypass && tenant) {
    const t = String(tenant);
    filter.$or = [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }];
  }
  try {
    const updated = await LLMCost.findOneAndUpdate(filter, req.body || {}, { new: true }).lean().exec();
    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    return res.status(200).json(updated);
  } catch (e) {
    if (e && e.name === 'ValidationError') {
      return res.status(422).json({ success: false, message: 'Validation failed', details: e.errors });
    }
    return res.status(400).json({ success: false, message: e?.message || 'Bad request' });
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid id' });
  }
  const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.costsAllTenantsBypass || req?.user?.isSuperAdmin);
  const tenant = req.tenantId || req?.auth?.tenantId || null;
  const filter = { _id: id };
  if (!bypass && tenant) {
    const t = String(tenant);
    filter.$or = [{ tenant_id: t }, { organization_id: t }, { organizationId: t }, { tenantId: t }, { 'tenant.tenant_id': t }];
  }
  const result = await LLMCost.deleteOne(filter).exec();
  if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Not found' });
  return res.status(200).json({ success: true, deleted: 1 });
}));

module.exports = router;
