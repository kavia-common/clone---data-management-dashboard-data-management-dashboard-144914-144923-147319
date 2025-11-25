const { parsePagination, success, failure } = require('../utils/http');

/**
 * Validate sort string against a whitelist to prevent unindexed/in-memory heavy sorts.
 * Supports formats: "field" or "-field". Returns a safe sort string.
 */
function validateSort(sort, allowed = ['timestamp', 'created_at', '_id']) {
  if (!sort || typeof sort !== 'string') {return '-timestamp';}
  const trimmed = sort.trim();
  const desc = trimmed.startsWith('-');
  const field = desc ? trimmed.slice(1) : trimmed;
  if (!allowed.includes(field)) {
    return '-timestamp';
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
    try { res.set('X-List-Error', (message || '').slice(0, 120)); } catch (_) {}
    return failure(res, 'Request failed', 400, { error: message });
  }

  return {
    // PUBLIC_INTERFACE
    async list(req, res) {
      // concise debug only in dev is handled below; avoid noisy param dump here
      // Determine effective tenant from JWT-backed middleware
      const effectiveTenant = req?.tenantId ? String(req.tenantId) : undefined;

      // Observability headers
      try {
        if (effectiveTenant) {
          res.set('x-organization-id', effectiveTenant);
          res.set('X-Applied-Tenant', effectiveTenant);
        }
        const authPresent = !!req.headers?.authorization;
        res.set('x-tenant-auth-present', String(authPresent));
      } catch (_) {}

      // Developer-mode log
      const debugOn = process.env.NODE_ENV !== 'production' || String(process.env.DEBUG || '').toLowerCase() === 'true';

      // Expose bypass status for tests/diagnostics
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
          console.debug(
            `[crudFactory.list] ${req.method} ${req.originalUrl} effectiveTenant=${effectiveTenant || 'n/a'} bypass=${bypassAny} (routeBypass=${routeBypass}, globalBypass=${globalBypass})`
          );
          // Explicit console.log for specific routes to confirm bypass visibility in terminal
          const isUsersRoute = (req.baseUrl || '').endsWith('/users') || (req.originalUrl || '').includes('/api/users');
          const isSessionsRoute = (req.baseUrl || '').endsWith('/session-tracking') || (req.originalUrl || '').includes('/api/session-tracking');
          const isDeploymentsRoute = (req.baseUrl || '').endsWith('/app-deployments') || (req.originalUrl || '').includes('/api/app-deployments');
          if (isUsersRoute) {
            console.log('[crudFactory.list:/api/users] bypass trace', {
              bypass: bypassAny, routeBypass, globalBypass, effectiveTenant: effectiveTenant || null,
              usersAllTenantsBypass: !!req.usersAllTenantsBypass
            });
          }
          if (isSessionsRoute) {
            console.log('[crudFactory.list:/api/session-tracking] bypass trace', {
              bypass: bypassAny, routeBypass, globalBypass, effectiveTenant: effectiveTenant || null,
              sessionsAllTenantsBypass: !!req.sessionsAllTenantsBypass
            });
          }
          if (isDeploymentsRoute) {
            console.log('[crudFactory.list:/api/app-deployments] bypass trace', {
              bypass: bypassAny, routeBypass, globalBypass, effectiveTenant: effectiveTenant || null,
              deploymentsAllTenantsBypass: !!req.deploymentsAllTenantsBypass
            });
          }
          const isCostsRoute = (req.baseUrl || '').endsWith('/llm-costs') || (req.originalUrl || '').includes('/api/llm-costs');
          if (isCostsRoute) {
            console.log('[crudFactory.list:/api/llm-costs] bypass trace', {
              bypass: bypassAny, routeBypass, globalBypass, effectiveTenant: effectiveTenant || null,
              costsAllTenantsBypass: !!req.costsAllTenantsBypass
            });
          }
        } catch (_) {}
      }

      // Parse pagination but hard-cap the limit to prevent heavy responses.
      const { page, limit: parsedLimit, skip, explicit } = parsePagination(req.query);
      const hardCappedLimit = clampLimit(parsedLimit, 500);

      // Parse filter safely with defensive fallback instead of failing with 400
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : (filterRaw || {});
      } catch (err) {
        // Defensive: fallback to empty filter and log concise reason
        console.warn('[crudFactory.list] filter parse failed; using empty filter', {
          route: req.originalUrl,
          reason: err?.message?.slice(0, 120) || 'parse error'
        });
        filter = {};
      }

      // Enforce tenant BEFORE any sort to promote index usage.
      // Allow Super Admin global mode to bypass tenant checks
      const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.usersAllTenantsBypass || req.sessionsAllTenantsBypass || req.deploymentsAllTenantsBypass);
      try { if (bypass) { res.set('X-All-Tenants', 'true'); } } catch(_) {}
      if (!bypass && !req.tenantId) {
        // Defensive behavior: return empty dataset with 200 to avoid breaking charts when tenant not resolved.
        // Add concise console log and diagnostics header; do not leak sensitive details.
        try {
          console.warn('[crudFactory.list] missing tenant scope; returning empty results', {
            route: req.originalUrl
          });
          res.set('X-Missing-Tenant', 'true');
        } catch (_) {}

        if (req.method === 'GET') {
          const { page, limit: parsedLimit, skip, explicit } = parsePagination(req.query);
          const hardCappedLimit = clampLimit(parsedLimit, 500);
          if (explicit) {
            return res.status(200).json({ success: true, data: [], meta: { page, limit: hardCappedLimit, total: 0 } });
          }
          return res.status(200).json([]);
        }
        return failure(res, 'Missing tenant scope', 400);
      }

      // If Authorization present, any client-supplied tenant filter/header/query must not switch tenants.
      // We do not read client-supplied tenant fields in filters, but for traceability, detect if they attempted.
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

      // Build final applied filter with robust tenant alias removal and normalized OR across aliases
      const appliedFilter = (req.tenantScopeDisabled || req.allTenants) ? (filter && typeof filter === 'object' ? filter : {}) : mergeFilterWithTenant(filter, req.tenantId);

      // Expose applied filter, model collection and quick existence probe for diagnostics
      try {
        const appliedFilterStr = JSON.stringify(appliedFilter);
        res.set('x-applied-tenant-filter', appliedFilterStr);
        res.set('X-Applied-Filter', appliedFilterStr);
        res.set('x-applied-organization-id', String(req.tenantId || ''));
        if (Model && Model.collection && Model.collection.name) {
          res.set('X-Model-Collection', Model.collection.name);
        }
      } catch (_) {}

      // Validate sort string against whitelist; default is listDefaultSort (expected '-timestamp').
      const safeSort = validateSort(req.query.sort || listDefaultSort, ['timestamp', 'created_at', '_id']);
      try {
        // Run a fast existence probe to help disambiguate empty responses: filter vs model/collection mismatch.
        let existsSample = 'unknown';
        try {
          const existsDoc = await Model.exists(
            appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {}
          ).lean?.();
          existsSample = existsDoc ? 'true' : 'false';
        } catch {
          // Some Mongoose versions don't support .lean on exists result; fallback
          try {
            const existsDoc = await Model.exists(
              appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {}
            );
            existsSample = existsDoc ? 'true' : 'false';
          } catch {
            existsSample = 'error';
          }
        }
        try {
          res.set('X-Exists-Sample', existsSample);
        } catch (_) {}

        if (debugOn) {
          try {
            
            console.debug('[crudFactory.list] appliedFilter=', appliedFilter, 'sort=', safeSort, 'exists=', existsSample);
          } catch (_) {}
        }

        if (req.method === 'GET' && explicit) {

          const key = buildListKey(req, appliedFilter, safeSort, page, hardCappedLimit, skip, explicit);
          const cached = microGet(key);
          if (cached) {return res.status(200).json(cached);}
          
          // Use allowDiskUse(true) for safety on large sorts; filter is enforced first.
          let query = Model.find(appliedFilter).sort(safeSort).skip(skip).limit(hardCappedLimit);
          try { if (typeof query.allowDiskUse === 'function') { query = query.allowDiskUse(true); } } catch (_) {}
          const [items, total] = await Promise.all([
            query.lean(),
            Model.countDocuments(appliedFilter),
          ]);
          console.debug('get data from db---->',items)
          const payload = { success: true, data: items, meta: { page, limit: hardCappedLimit, total } };
          microSet(key, payload);
          return res.status(200).json(payload);
        }

        // Non-paginated path: enforce safeSort; allowDiskUse when available.
        let queryNP = Model.find(appliedFilter).sort(safeSort);
        try { if (typeof queryNP.allowDiskUse === 'function') { queryNP = queryNP.allowDiskUse(true); } } catch (_) {}
        const items = await queryNP.lean();
        return res.status(200).json(items);
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
