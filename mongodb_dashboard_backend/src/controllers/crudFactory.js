const { parsePagination, success, failure } = require('../utils/http');

/**
 * Validate sort string against a whitelist to prevent unindexed/in-memory heavy sorts.
 * Supports formats: "field" or "-field". Returns a safe sort string.
 */
function validateSort(sort, allowed = ['timestamp', 'created_at', '_id']) {
  // Returns a safe sort string "-field" or "field" constrained to allowed list.
  // If sort is missing or not allowed, default to first item from allowed prefixed with '-'.
  const fallback = allowed && allowed.length ? `-${allowed[0]}` : '-timestamp';
  if (!sort || typeof sort !== 'string') {return fallback;}
  const trimmed = sort.trim();
  const desc = trimmed.startsWith('-');
  const field = desc ? trimmed.slice(1) : trimmed;
  if (!allowed.includes(field)) {
    return fallback;
  }
  return desc ? `-${field}` : field;
}

/**
 * Enforce a maximum page size limit for safety.
 */
function clampLimit(limit, max = 500) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n)) {return Math.min(20, max);}
  return Math.max(1, Math.min(n, max));
}

/**
 * Lightweight micro-cache for list endpoints to coalesce identical rapid requests.
 * Default TTL: 2000ms. Intended to mitigate bursts from quick sort/page toggles.
 * Note: In-memory and per-process only.
 */
const MICRO_CACHE_TTL_MS = parseInt(process.env.MICRO_CACHE_TTL_MS || '2000', 10);
const listMicroCache = new Map(); // key -> { expiresAt:number, payload:any }

/**
 * PUBLIC_INTERFACE
 * Get a micro-cached value if not expired.
 */
function microGet(key) {
  const hit = listMicroCache.get(key);
  if (!hit) {return null;}
  if (Date.now() > hit.expiresAt) {
    listMicroCache.delete(key);
    return null;
  }
  return hit.payload;
}

/**
 * PUBLIC_INTERFACE
 * Set a micro-cached value with TTL.
 */
function microSet(key, payload) {
  listMicroCache.set(key, { payload, expiresAt: Date.now() + MICRO_CACHE_TTL_MS });
}

/**
 * Build a stable cache key for list requests.
 */
function buildListKey(req, filter, sort, page, limit, skip, explicit) {
  // baseUrl+path are stable per router mount; include query-shaping inputs.
  return `list:${req.baseUrl}${req.path}:${JSON.stringify({ filter, sort, page, limit, skip, explicit })}`;
}

/**
 * Sanitize the incoming payload for create/update:
 * - Ensure it's an object
 * - Strip client-provided tenant_id and inject from req.tenantId when available
 */
function sanitizePayloadWithTenant(req) {
  if (!req || typeof req !== 'object') {return null;}
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {return null;}
  const clean = { ...body };
  // Strip all client-supplied tenant/org fields defensively
  delete clean.tenant_id;
  delete clean.tenantId;
  delete clean.organization_id;
  delete clean.organizationId;
  delete clean.orgId;

  // If bypass active (Super Admin global), do NOT stamp tenant_id on create/update
  const bypass = !!(req.tenantScopeDisabled || req.allTenants);
  if (!bypass && req.tenantId) {
    clean.tenant_id = String(req.tenantId);
  }
  return clean;
}

/**
 * Merge filter safely with enforced tenant_id, ignoring any client-provided tenant keys.
 */
function mergeFilterWithTenant(filter, tenantId) {
  const f = filter && typeof filter === 'object' ? { ...filter } : {};
  // strip possible client-supplied tenant hints
  delete f.tenant_id;
  delete f.tenantId;
  delete f.organization_id;
  delete f.organizationId;
  delete f.orgId;

  if (!tenantId) {return f;}

  // Build a normalized tenant filter to match across possible fields (defensive)
  const normalizedTenantFilter = {
    $or: [
      { tenant_id: String(tenantId) },
      { organization_id: String(tenantId) },
      { orgId: String(tenantId) },
      { tenantId: String(tenantId) },
      { organizationId: String(tenantId) },
      { 'tenant.tenant_id': String(tenantId) },
    ],
  };

  // enforce tenant filter
  return Object.keys(f).length > 0 ? { $and: [f, normalizedTenantFilter] } : normalizedTenantFilter;
}

/**
 * Build a REST controller for a Mongoose model with tenant enforcement.
 */
function buildCrudController(Model, listDefaultSort = '-timestamp') {
  // Map known Mongoose errors to user-friendly responses
  function mapAndReplyError(res, err, context = 'operation') {
    const name = err?.name || '';
    const message = err?.message || 'Unknown error';

    if (name === 'CastError' || /Cast to/.test(message)) {
      return failure(res, `Invalid value provided (${context})`, 400, { error: message });
    }
    if (name === 'ValidationError') {
      return failure(res, 'Validation failed', 422, { error: message, details: err?.errors || undefined });
    }
    return failure(res, 'Request failed', 400, { error: message });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      // Mandatory pagination and high-performance list handler
      const effectiveTenant = req?.tenantId ? String(req.tenantId) : undefined;

      // Headers
      try {
        if (effectiveTenant) {
          res.set('x-organization-id', effectiveTenant);
          res.set('X-Applied-Tenant', effectiveTenant);
        }
        res.set('x-tenant-auth-present', String(!!req.headers?.authorization));
      } catch (_) {}

      const debugOn = process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true';

      // Bypass diagnostics
      try {
        const bypassHeader = !!(req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin);
        res.set('X-Tenant-Bypass', String(bypassHeader));
      } catch (_) {}

      if (debugOn) {
        try {
          const routeBypass =
            !!req.usersAllTenantsBypass ||
            !!req.sessionsAllTenantsBypass ||
            !!req.deploymentsAllTenantsBypass ||
            !!req.costsAllTenantsBypass;
          const globalBypass = !!(req.tenantScopeDisabled || req.allTenants || req?.user?.isSuperAdmin);
          const bypassAny = routeBypass || globalBypass;
          const isCostsRoute = (req.baseUrl || '').endsWith('/llm-costs') || (req.originalUrl || '').includes('/api/llm-costs');
          if (isCostsRoute) {
            console.log('[crudFactory.list:/api/llm-costs] bypass trace', {
              bypass: bypassAny, routeBypass, globalBypass, effectiveTenant: effectiveTenant || null,
              costsAllTenantsBypass: !!req.costsAllTenantsBypass
            });
          }
        } catch (_) {}
      }

      // Enforce pagination: require explicit page & limit on llm-costs
      const isLLMCost = Model?.modelName === 'LLMCost';
      const { page, limit: parsedLimit, skip, explicit } = parsePagination(req.query);
      const MAX_LIMIT = 100;
      const hardCappedLimit = clampLimit(parsedLimit, MAX_LIMIT);

      if (isLLMCost) {
        const pageValid = Number.isFinite(page) && page >= 1;
        const limitValid = Number.isFinite(parsedLimit) && parsedLimit >= 1;
        if (!pageValid || !limitValid) {
          return failure(res, 'Pagination required: provide valid ?page>=1 and ?limit(<=100)', 400);
        }
      }

      // Parse filter
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch (err) {
        return failure(res, 'Invalid filter JSON', 400);
      }

      // Build bypass and tenant resolution
      const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.usersAllTenantsBypass || req.sessionsAllTenantsBypass || req.deploymentsAllTenantsBypass || req.costsAllTenantsBypass);
      try { if (bypass) { res.set('X-All-Tenants', 'true'); } } catch(_) {}

      if (!bypass && !req.tenantId) {
        const hdrOrg =
          (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
          (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
          '';
        const qOrg =
          (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
          (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
          '';
        if (hdrOrg || qOrg) {
          req.tenantId = String(hdrOrg || qOrg);
        }
      }
      if (!bypass && !req.tenantId) {
        return failure(res, 'Missing tenant scope', 400);
      }

      // Reject tenant switch when Authorization sent
      const clientRequestedTenant =
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        '';
      const hasAuthHeader = !!req.headers?.authorization;
      if (!bypass && hasAuthHeader && clientRequestedTenant && String(clientRequestedTenant) !== String(req.tenantId)) {
        return failure(res, 'Forbidden: tenant scope mismatch', 403);
      }

      // Merge filter with tenant and time window for LLM costs
      // Enforce a default 30-day window if client does not provide one; use 'timestamp' indexed field fallback to created_at
      if (isLLMCost) {
        const now = new Date();
        const toISO = req.query.to || null;
        const fromISO = req.query.from || null;
        let to = toISO ? new Date(toISO) : now;
        let from = fromISO ? new Date(fromISO) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (isNaN(from.getTime())) { from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); }
        if (isNaN(to.getTime())) { to = now; }

        // Build a time match on timestamp with fallback path handled in $addFields
        const timeFilter = { timestamp: { $gte: from, $lte: to } };
        if (filter && typeof filter === 'object' && Object.keys(filter).length) {
          filter = { $and: [filter, timeFilter] };
        } else {
          filter = timeFilter;
        }
        try {
          res.set('X-Time-Window', JSON.stringify({ from: from.toISOString(), to: to.toISOString() }));
        } catch (_) {}
      }

      const appliedFilter = (req.tenantScopeDisabled || req.allTenants) ? (filter && typeof filter === 'object' ? filter : {}) : mergeFilterWithTenant(filter, req.tenantId);

      try {
        const appliedFilterStr = JSON.stringify(appliedFilter);
        res.set('x-applied-tenant-filter', appliedFilterStr);
        res.set('X-Applied-Filter', appliedFilterStr);
        res.set('x-applied-organization-id', String(req.tenantId || ''));
        if (Model && Model.collection && Model.collection.name) {
          res.set('X-Model-Collection', Model.collection.name);
        }
      } catch (_) {}

      // Allowed sorts
      const isAppDeployment = Model?.modelName === 'AppDeployment';
      const allowedSorts = isAppDeployment
        ? ['timestamp', 'created_at', 'updated_at', '_id', 'status', 'branch_name', 'project_name']
        : ['timestamp', 'created_at', '_id'];
      const safeSort = validateSort(req.query.sort || listDefaultSort, allowedSorts);

      try {
        // small exist check
        try {
          const existsDoc = await Model.exists(appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {});
          res.set('X-Exists-Sample', existsDoc ? 'true' : 'false');
        } catch { res.set('X-Exists-Sample', 'error'); }

        // Mandatory pagination path for LLM costs; use lean pipeline with projection and maxTimeMS
        if (isLLMCost) {
          const sortStage = safeSort
            ? (safeSort.startsWith('-') ? { [safeSort.slice(1)]: -1 } : { [safeSort]: 1 })
            : { timestamp: -1 };

          // Compact projection
          const projection = {
            _id: 1,
            tenant_id: 1,
            organization_id: 1,
            user_id: 1,
            task_id: 1,
            session_id: 1,
            llm_model: 1,
            provider: 1,
            service_type: 1,
            total_cost: 1,
            currency: 1,
            timestamp: 1,
            created_at: 1,
          };

          // Covered index hints: prefer {tenant_id:1,timestamp:-1,_id:1} then {organization_id:1,timestamp:-1,_id:1}
          const hintTenant = { tenant_id: 1, timestamp: -1, _id: 1 };
          const hintOrg = { organization_id: 1, timestamp: -1, _id: 1 };

          // Use aggregation to normalize timestamp and projection; ensure maxTimeMS and slow logging
          const pipeline = [
            { $match: appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {} },
            { $addFields: { timestamp: { $ifNull: ['$timestamp', '$created_at'] } } },
            { $sort: sortStage },
            { $skip: skip },
            { $limit: hardCappedLimit },
            { $project: projection },
          ];

          const start = Date.now();
          let items;
          try {
            // Prefer hint on collection if possible: use Model.collection.aggregate for hint
            const agg = Model.collection.aggregate(pipeline, { allowDiskUse: true, maxTimeMS: 15000 });
            try {
              // best-effort apply hint; Mongo Node driver supports .hint on aggregate cursor in newer versions
              agg.hint(appliedFilter?.$and ? hintTenant : hintTenant);
            } catch (_) {}
            items = await agg.toArray();
          } catch (e1) {
            // fallback without hint
            items = await Model.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 15000 });
          } finally {
            const dur = Date.now() - start;
            if (dur > 1000) {
              console.warn('[llm-costs:list] slow query', { ms: dur, page, limit: hardCappedLimit, sort: safeSort });
            }
          }

          // total count with same filter but fast path and timeout
          let total = 0;
          try {
            total = await Model.countDocuments(appliedFilter).maxTimeMS?.(5000) ?? await Model.countDocuments(appliedFilter);
          } catch (_) {
            // ignore timeout on count
          }

          const payload = { success: true, data: items, meta: { page, limit: hardCappedLimit, total } };
          return res.status(200).json(payload);
        }

        // Non-LLM cost models retain previous behavior but add maxTimeMS
        let query = Model.find(appliedFilter).sort(safeSort).skip(skip).limit(hardCappedLimit).allowDiskUse(true).lean();
        try { if (typeof query.maxTimeMS === 'function') { query = query.maxTimeMS(15000); } } catch (_) {}
        const items = await query;
        const total = await Model.countDocuments(appliedFilter);
        return res.status(200).json({ success: true, data: items, meta: { page, limit: hardCappedLimit, total } });
      } catch (err) {
        return mapAndReplyError(res, err, 'list');
      }
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      const { id } = req.params;
      try {
        const bypass = !!(req.tenantScopeDisabled || req.allTenants);
        const match = bypass
          ? { _id: id }
          : {
              _id: id,
              $or: [
                { tenant_id: String(req.tenantId) },
                { organization_id: String(req.tenantId) },
                { orgId: String(req.tenantId) },
                { tenantId: String(req.tenantId) },
                { organizationId: String(req.tenantId) },
                { 'tenant.tenant_id': String(req.tenantId) },
              ],
            };
        const doc = await Model.findOne(match).lean();
        if (!doc) {return failure(res, 'Not found', 404);}
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'getById');
      }
    },

    // PUBLIC_INTERFACE
    async create(req, res) {
      const clean = sanitizePayloadWithTenant(req);
      if (!clean) {return failure(res, 'Bad request: payload must be an object', 400);}
      try {
        const doc = await Model.create(clean);
        return res.status(201).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'create');
      }
    },

    // PUBLIC_INTERFACE
    async update(req, res) {
      const { id } = req.params;
      const clean = sanitizePayloadWithTenant(req);
      if (!clean) {return failure(res, 'Bad request: payload must be an object', 400);}
      try {
        const bypass = !!(req.tenantScopeDisabled || req.allTenants);
        const match = bypass
          ? { _id: id }
          : {
              _id: id,
              $or: [
                { tenant_id: String(req.tenantId) },
                { organization_id: String(req.tenantId) },
                { orgId: String(req.tenantId) },
                { tenantId: String(req.tenantId) },
                { organizationId: String(req.tenantId) },
                { 'tenant.tenant_id': String(req.tenantId) },
              ],
            };
        const doc = await Model.findOneAndUpdate(match, clean, { new: true }).lean();
        if (!doc) {return failure(res, 'Not found', 404);}
        return res.status(200).json(doc);
      } catch (err) {
        return mapAndReplyError(res, err, 'update');
      }
    },

    // PUBLIC_INTERFACE
    async remove(req, res) {
      const { id } = req.params;
      try {
        const bypass = !!(req.tenantScopeDisabled || req.allTenants);
        const match = bypass
          ? { _id: id }
          : {
              _id: id,
              $or: [
                { tenant_id: String(req.tenantId) },
                { organization_id: String(req.tenantId) },
                { orgId: String(req.tenantId) },
                { tenantId: String(req.tenantId) },
                { organizationId: String(req.tenantId) },
                { 'tenant.tenant_id': String(req.tenantId) },
              ],
            };
        const doc = await Model.findOneAndDelete(match).lean();
        if (!doc) {return failure(res, 'Not found', 404);}
        return res.status(200).json({ _id: id });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },
  };
}

module.exports = { buildCrudController };
