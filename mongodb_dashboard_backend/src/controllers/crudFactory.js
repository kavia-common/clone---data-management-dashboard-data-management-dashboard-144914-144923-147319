const { parsePagination, success, failure, withRequestTimeout } = require('../utils/http');

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
function clampLimit(limit, max = 200, defaultLimit = 25) {
  const n = parseInt(limit, 10);
  if (!Number.isFinite(n)) {return Math.min(defaultLimit, max);}
  const capped = Math.max(1, Math.min(n, max));
  // Additional safety: default page size should not exceed 50, and hard cap at 1000
  return Math.min(capped, max);
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

  // Build a default date range filter (last 180 days) on timestamp/created_at if none specified.
  // Rationale: Historical data often spans months; a too-narrow default silently empties results.
  // Apply default ONLY when no explicit timestamp/created_at criteria is present anywhere in the filter.
  function injectDefaultDateWindowIfMissing(modelName, filter, opts = {}) {
    try {
      if (modelName !== 'LLMCost') return filter;
      const f = filter && typeof filter === 'object' ? { ...filter } : {};
      // If a tenant is explicitly resolved, do NOT apply any implicit date window (relaxed default)
      if (opts && opts.explicitTenant) {
        return f;
      }
      // Helper to recursively detect timestamp/created_at usage in nested filters
      const hasDateIn = (obj) => {
        if (!obj || typeof obj !== 'object') return false;
        if (obj.timestamp && typeof obj.timestamp === 'object') return true;
        if (obj.created_at && typeof obj.created_at === 'object') return true;
        if (Array.isArray(obj.$and) && obj.$and.some((c) => hasDateIn(c))) return true;
        if (Array.isArray(obj.$or) && obj.$or.some((c) => hasDateIn(c))) return true;
        return false;
      };
      if (hasDateIn(f)) return f;

      const to = new Date();
      // More permissive default: last 180 days
      const from = new Date(to.getTime() - 180 * 24 * 60 * 60 * 1000);
      const dateRange = {
        $or: [
          { timestamp: { $gte: from, $lte: to } },
          { created_at: { $gte: from, $lte: to } },
        ],
      };
      return Object.keys(f).length ? { $and: [f, dateRange] } : dateRange;
    } catch {
      return filter;
    }
  }
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
      // For GET endpoints, disable caching to avoid conditional requests returning 304 with empty body
      try {
        if (req.method === 'GET') {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
          res.set('Pragma', 'no-cache');
          res.set('Expires', '0');
          if (typeof res.removeHeader === 'function') {
            res.removeHeader('ETag');
            res.removeHeader('Last-Modified');
          }
          res.set('ETag', 'W/"disabled"');
        }
      } catch (_) {}
      // list handler for generic model with tenant scoping
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
      // For LLMCosts, keep small default cap (<=50) and hard cap 1000
      const isLLMCostModel = Model?.modelName === 'LLMCost';
      const hardCappedLimit = isLLMCostModel ? clampLimit(parsedLimit, 1000, 50) : clampLimit(parsedLimit, 500, 50);

      // Parse filter safely
      const filterRaw = req.query.filter ? req.query.filter : '{}';
      // parse query filter JSON if provided
      let filter = {};
      try {
        filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
      } catch (err) {
        return failure(res, 'Invalid filter JSON', 400);
      }

      // Enforce tenant BEFORE any sort to promote index usage.
      // Allow Super Admin global mode to bypass tenant checks
      const bypass = !!(req.tenantScopeDisabled || req.allTenants || req.usersAllTenantsBypass || req.sessionsAllTenantsBypass || req.deploymentsAllTenantsBypass || req.costsAllTenantsBypass);
      try { if (bypass) { res.set('X-All-Tenants', 'true'); } } catch(_) {}
      // Relaxed: allow tenant alias resolution from headers/queries when not bypassed
      if (!bypass && !req.tenantId) {
        const hdrOrg =
          (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
          (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
          (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
          '';
        const qOrg =
          (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
          (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
          (typeof req.query?.org_id === 'string' && req.query.org_id.trim()) ||
          (typeof req.query?.organizationId === 'string' && req.query.organizationId.trim()) ||
          (typeof req.query?.tenantId === 'string' && req.query.tenantId.trim()) ||
          '';
        if (hdrOrg || qOrg) {
          req.tenantId = String(hdrOrg || qOrg);
        }
      }
      if (!bypass && !req.tenantId) {
        return failure(res, 'Missing tenant scope', 400);
      }

      // If Authorization present, any client-supplied tenant filter/header/query must not switch tenants.
      // We do not read client-supplied tenant fields in filters, but for traceability, detect if they attempted.
      const clientRequestedTenant =
        (typeof req.query?.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        (typeof req.query?.organization_id === 'string' && req.query.organization_id.trim()) ||
        (typeof req.query?.org_id === 'string' && req.query.org_id.trim()) ||
        (typeof req.headers?.['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
        (typeof req.headers?.['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
        (typeof req.headers?.['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
        '';

      const hasAuthHeader = !!req.headers?.authorization;
      if (!bypass && hasAuthHeader && clientRequestedTenant && String(clientRequestedTenant) !== String(req.tenantId)) {
        return failure(res, 'Forbidden: tenant scope mismatch', 403);
      }

      // Build final applied filter with robust tenant alias removal and normalized OR across aliases
      let appliedFilter = (req.tenantScopeDisabled || req.allTenants) ? (filter && typeof filter === 'object' ? filter : {}) : mergeFilterWithTenant(filter, req.tenantId);
      // Inject default date window for LLMCosts only when no explicit tenant is present (relaxed when organization provided)
      appliedFilter = injectDefaultDateWindowIfMissing(Model?.modelName, appliedFilter, { explicitTenant: !!req.tenantId });

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

      // Determine allowed sort fields per model and validate sort string
      const isAppDeployment = Model?.modelName === 'AppDeployment';
      const isLLMCost = Model?.modelName === 'LLMCost';
      const allowedSorts = isAppDeployment
        ? ['timestamp', 'created_at', 'updated_at', '_id', 'status', 'branch_name', 'project_name']
        : ['timestamp', 'created_at', '_id'];
      const safeSort = validateSort(req.query.sort || listDefaultSort, allowedSorts);
      const sortStage = safeSort
        ? (safeSort.startsWith('-') ? { [safeSort.slice(1)]: -1, _id: -1 } : { [safeSort]: 1, _id: 1 })
        : { timestamp: -1, _id: -1 };

      // execute DB operations with safe sort and enforced tenant filter
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
          // pagination path

        if (req.method === 'GET' && explicit) {
          // cache and return envelope
          const key = buildListKey(req, appliedFilter, safeSort, page, hardCappedLimit, skip, explicit);
          const cached = microGet(key);
          if (cached) {return res.status(200).json(cached);}

          const runQuery = async () => {
            // Quick path: counts only
            if (String(req.query.counts || req.query.count || req.query.onlyCounts || '') === 'true') {
              const total = await Model.countDocuments(appliedFilter).maxTimeMS?.(600) ?? await Model.countDocuments(appliedFilter);
              return { items: [], total };
            }
            // Use allowDiskUse(true) for safety on large sorts; filter is enforced first.
            let items;
            if (isLLMCost) {
              try {
                const pipeline = [
                  { $match: appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {} },
                  // Normalize key fields for downstream sort/projection
                  { $addFields: {
                      timestamp: { $ifNull: ['$timestamp', '$created_at'] },
                      created_at: { $ifNull: ['$created_at', '$timestamp'] },
                      organization_id: { $ifNull: ['$organization_id', '$tenant_id'] },
                      numeric_total_cost: {
                        $convert: {
                          input: {
                            $replaceAll: {
                              input: { $toString: { $ifNull: ['$total_cost', 0] } },
                              find: '$',
                              replacement: ''
                            }
                          },
                          to: 'double',
                          onError: 0,
                          onNull: 0
                        }
                      }
                    }
                  },
                  { $sort: sortStage },
                  { $skip: skip },
                  { $limit: hardCappedLimit },
                ];
                // Set per-op timeout
                items = await Model.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 800 });
              } catch (_) {
                // Fallback: prefer minimal projection to reduce payload
                const projection = { breakdown: 0, metadata: 0 };
                items = await Model.find(appliedFilter, projection).sort(sortStage).skip(skip).limit(hardCappedLimit).maxTimeMS(800).lean();
              }
            } else if (isAppDeployment) {
              try {
                const pipeline = [
                  { $match: appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {} },
                  { $addFields: {
                      // Normalize timestamp fields for consistent sorting
                      timestamp: { $ifNull: ['$timestamp', '$created_at'] },
                      created_at: { $ifNull: ['$created_at', '$createdAt'] },
                      updated_at: { $ifNull: ['$updated_at', '$updatedAt'] },
                      // Compute project_name from various sources
                      project_name: {
                        $ifNull: [
                          '$project_name',
                          { $ifNull: ['$projectName', { $ifNull: ['$metadata.projectName', '$project.name'] }] }
                        ]
                      }
                    }
                  },
                  { $sort: sortStage },
                  { $skip: skip },
                  { $limit: hardCappedLimit },
                ];
                items = await Model.aggregate(pipeline).allowDiskUse(true);
              } catch (_) {
                // Fallback: simple find; project_name may be missing if stored under a different key
                items = await Model.find(appliedFilter).sort(sortStage).skip(skip).limit(hardCappedLimit).allowDiskUse(true).lean();
              }
            } else {
              items = await Model.find(appliedFilter).sort(sortStage).skip(skip).limit(hardCappedLimit).allowDiskUse(true).lean();
            }
            const total = await Model.countDocuments(appliedFilter).maxTimeMS?.(600) ?? await Model.countDocuments(appliedFilter);
            return { items, total };
          };

          const timed = await withRequestTimeout(runQuery, {
            ms: 900,
            onTimeout: async () => {
              // Produce a partial, lightweight snapshot
              const projection = isLLMCostModel
                ? { _id: 1, timestamp: 1, created_at: 1, total_cost: 1, tenant_id: 1, organization_id: 1 }
                : { _id: 1 };
              const items = await Model.find(appliedFilter, projection).sort(sortStage).limit(Math.min(hardCappedLimit, 25)).lean();
              return { items, total: undefined };
            },
          });

          if (timed.timedOut) {
            return res.status(206).json({
              success: true,
              data: timed.partial?.items || [],
              meta: { page, limit: hardCappedLimit, total: timed.partial?.total ?? null, partial: true, timeoutMs: 900 },
            });
          }
          if (timed.error) {
            throw timed.error;
          }
          const { items, total } = timed.value || { items: [], total: 0 };
          const payload = { success: true, data: items, meta: { page, limit: hardCappedLimit, total } };
          microSet(key, payload);
          return res.status(200).json(payload);
        }

        // Non-paginated path: still enforce allowDiskUse and safeSort with tenant filter first.
        // For LLMCost model, add a light projection to ensure timestamp field presence and numeric cost coercion for clients.
        // Avoid allowDiskUse on simple find; prefer aggregation for heavy ops
        let query = Model.find(appliedFilter, { breakdown: 0, metadata: 0 }).sort(sortStage).lean();
        try {
          const runAgg = async () => {
            if (isLLMCost) {
              // Use aggregation for minimal transformation without large memory footprint
              const pipeline = [
                { $match: appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {} },
                { $addFields: {
                    timestamp: { $ifNull: ['$timestamp', '$created_at'] },
                    created_at: { $ifNull: ['$created_at', '$timestamp'] },
                    organization_id: { $ifNull: ['$organization_id', '$tenant_id'] },
                    numeric_total_cost: {
                      $convert: {
                        input: {
                          $replaceAll: {
                            input: { $toString: { $ifNull: ['$total_cost', 0] } },
                            find: '$',
                            replacement: ''
                          }
                        },
                        to: 'double',
                        onError: 0,
                        onNull: 0
                      }
                    }
                  }
                },
                { $sort: sortStage },
              ];
              return await Model.aggregate(pipeline).allowDiskUse(true).option({ maxTimeMS: 800 });
            }
            if (isAppDeployment) {
              const pipeline = [
                { $match: appliedFilter && typeof appliedFilter === 'object' ? appliedFilter : {} },
                { $addFields: {
                    timestamp: { $ifNull: ['$timestamp', '$created_at'] },
                    created_at: { $ifNull: ['$created_at', '$createdAt'] },
                    updated_at: { $ifNull: ['$updated_at', '$updatedAt'] },
                    project_name: {
                      $ifNull: [
                        '$project_name',
                        { $ifNull: ['$projectName', { $ifNull: ['$metadata.projectName', '$project.name'] }] }
                      ]
                    }
                  }
                },
                { $sort: sortStage },
              ];
              return await Model.aggregate(pipeline).allowDiskUse(true);
            }
            // default (non-LLMCost/AppDeployment) just returns the query results
            return await Model.find(appliedFilter).sort(sortStage).maxTimeMS(800).allowDiskUse(true).lean();
          };

          const timed = await withRequestTimeout(runAgg, {
            ms: 900,
            onTimeout: async () => {
              const projection = isLLMCostModel
                ? { _id: 1, timestamp: 1, created_at: 1, total_cost: 1, tenant_id: 1, organization_id: 1 }
                : { _id: 1 };
              return await Model.find(appliedFilter, projection).sort(sortStage).limit(25).lean();
            },
          });

          if (timed.timedOut) {
            return res.status(206).json(timed.partial || []);
          }
          if (timed.error) {
            throw timed.error;
          }
          const items = Array.isArray(timed.value) ? timed.value : (timed.value || []);
          try {
            res.set('X-Result-Empty', String(!items || items.length === 0));
          } catch (_) {}
          return res.status(200).json(items);
        } catch (_) {
          // Fallback to simple find if any aggregation operator unsupported
          const items = await query;
          return res.status(200).json(items);
        }
      } catch (err) {
        return mapAndReplyError(res, err, 'list');
      }
    },

    // PUBLIC_INTERFACE
    async getById(req, res) {
      try {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        if (typeof res.removeHeader === 'function') {
          res.removeHeader('ETag');
          res.removeHeader('Last-Modified');
        }
        res.set('ETag', 'W/"disabled"');
      } catch (_) {}
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
        try {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
          if (typeof res.removeHeader === 'function') { res.removeHeader('ETag'); res.removeHeader('Last-Modified'); }
          res.set('ETag', 'W/"disabled"');
        } catch (_) {}
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
        try {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
          if (typeof res.removeHeader === 'function') { res.removeHeader('ETag'); res.removeHeader('Last-Modified'); }
          res.set('ETag', 'W/"disabled"');
        } catch (_) {}
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
        try {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0, private');
          if (typeof res.removeHeader === 'function') { res.removeHeader('ETag'); res.removeHeader('Last-Modified'); }
          res.set('ETag', 'W/"disabled"');
        } catch (_) {}
        return res.status(200).json({ _id: id });
      } catch (err) {
        return mapAndReplyError(res, err, 'remove');
      }
    },
  };
}

module.exports = { buildCrudController };
