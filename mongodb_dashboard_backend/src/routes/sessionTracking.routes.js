const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * @swagger
 * tags:
 *   name: SessionTracking
 *   description: Session tracking collection endpoints
 */

/**
 * Convert possible Decimal128 or string values to plain JS numbers.
 * Keeps numbers as-is; returns NaN if it cannot be parsed (caller can coerce to 0).
 */
function toNumber(val) {
  if (typeof val === 'number') return val;
  if (val && typeof val === 'object') {
    if (typeof val.$numberDecimal === 'string') {
      const n = parseFloat(val.$numberDecimal);
      return Number.isNaN(n) ? NaN : n;
    }
    if (val._bsontype === 'Decimal128' && typeof val.toString === 'function') {
      const n = parseFloat(val.toString());
      return Number.isNaN(n) ? NaN : n;
    }
  }
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return Number.isNaN(n) ? NaN : n;
  }
  // Fallback attempt
  const n = Number(val);
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Normalize a session document:
 * - Ensure total_cost is a number (default 0 if NaN/undefined)
 * - Ensure cost_history[].total_cost are numbers
 * - Ensure agent_costs values are numbers
 */
function normalizeSessionDoc(doc) {
  const out = { ...doc };

  const cost = toNumber(out.total_cost);
  out.total_cost = Number.isFinite(cost) ? cost : 0;

  if (Array.isArray(out.cost_history)) {
    out.cost_history = out.cost_history.map((h) => {
      const hh = { ...h };
      const hc = toNumber(hh.total_cost);
      hh.total_cost = Number.isFinite(hc) ? hc : 0;
      if (hh.agent_costs && typeof hh.agent_costs === 'object') {
        const newAC = {};
        for (const k of Object.keys(hh.agent_costs)) {
          const v = toNumber(hh.agent_costs[k]);
          newAC[k] = Number.isFinite(v) ? v : 0;
        }
        hh.agent_costs = newAC;
      }
      return hh;
    });
  }

  if (out.agent_costs && typeof out.agent_costs === 'object') {
    const newAC = {};
    for (const k of Object.keys(out.agent_costs)) {
      const v = toNumber(out.agent_costs[k]);
      newAC[k] = Number.isFinite(v) ? v : 0;
    }
    out.agent_costs = newAC;
  }

  return out;
}

/**
 * @swagger
 * /api/session-tracking:
 *   get:
 *     summary: List session tracking records
 *     description: >
 *       Returns a list of session tracking documents. If explicit pagination (page/limit) is provided,
 *       the response will be wrapped in an envelope with meta; otherwise, a raw array is returned.
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Alias for "limit" (page size)
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: JSON filter (e.g., {"tenant_id":"org1","status":"active"}). Any tenant_id/organization_id keys are ignored server-side; tenant is enforced from ?tenant_id or fallbacks.
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: >
 *           Case-insensitive text search applied across multiple fields:
 *           task_id, tenant_id, organization_name, user_name, project_id, container_id,
 *           service_type, status, and session_data fields (session_name, description, llm_model).
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Invalid filter
 */
/**
 * Local micro-cache for sessions list to mitigate back-to-back identical requests.
 */
const SESS_LIST_TTL_MS = parseInt(process.env.MICRO_CACHE_TTL_MS || '2000', 10);
const sessionsListCache = new Map(); // key -> { payload, expiresAt }
function slGet(key) {
  const hit = sessionsListCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    sessionsListCache.delete(key);
    return null;
  }
  return hit.payload;
}
function slSet(key, payload) {
  sessionsListCache.set(key, { payload, expiresAt: Date.now() + SESS_LIST_TTL_MS });
}

// PUBLIC_INTERFACE
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Enforce tenant scope strictly via ?tenant_id=... query param
    // Accept legacy fallbacks only if tenant_id is not provided
    const tenantFromQuery = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const legacyHeaderTenant =
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      '';
    const tenantFromLegacyQuery =
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) || '';
    const enforcedTenant = tenantFromQuery || tenantFromLegacyQuery || legacyHeaderTenant || null;

    // If a tenant is required for this endpoint, validate presence
    if (!enforcedTenant) {
      return res.status(400).json({
        success: false,
        message:
          'tenant_id is required. Provide ?tenant_id=... (legacy fallbacks: header x-tenant-id/x-organization-id or ?organization_id=...)',
      });
    }

    // Parse pagination and filter (support pageSize alias for limit)
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Optional text query
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    let qFilter = {};
    if (q) {
      const regex = new RegExp(q, 'i');
      qFilter = {
        $or: [
          { task_id: regex },
          { tenant_id: regex },
          { organization_name: regex },
          { user_name: regex }, // actual field in schema
          { User_name: regex }, // alias supported by mongoose for compatibility
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
      // TODO: Consider adding dedicated text or compound indexes for large datasets
      // e.g., db.session_tracking.createIndex({ user_name: "text", organization_name: "text", ... })
    }

    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let filter = {};
    try {
      filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Remove any attempt to bypass org scoping
    if (filter && typeof filter === 'object') {
      delete filter.organization_id;
      delete filter.tenant_id;
      delete filter.organizationId;
      if (Array.isArray(filter.$or)) delete filter.$or;
    }

    // Build enforced tenant scope across alternate schema fields
    const enforcedScope = enforcedTenant
      ? {
          $or: [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
          ],
        }
      : {};

    // Combine filters and full text query
    const combined = q && qFilter.$or && qFilter.$or.length > 0 ? { $and: [filter, qFilter] } : filter;
    const finalFilter =
      Object.keys(enforcedScope).length > 0 ? { $and: [combined, enforcedScope] } : combined;

    const debugEnabled = String(req.query.debug || 'false') === 'true';

    try {
      if (explicit) {
        // Micro-cache explicit list result by params
        const cacheKey = `sessions-list:${JSON.stringify({
          path: req.path,
          page,
          limit,
          sort,
          filter: finalFilter,
        })}`;
        const cached = slGet(cacheKey);
        if (cached) return res.status(200).json(cached);

        const [docs, total] = await Promise.all([
          // Use model documents (no lean) so Mongoose applies basic casting; still normalize to be safe
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);
        const items = docs.map((d) => normalizeSessionDoc(d.toObject({ getters: true })));
        const meta = { page, limit, total };
        if (debugEnabled) meta.debug = { finalFilter, sort, skip, limit };
        const payload = { success: true, data: items, meta };
        slSet(cacheKey, payload);
        return res.status(200).json(payload);
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      const items = docs.map((d) => normalizeSessionDoc(d.toObject({ getters: true })));
      if (debugEnabled) {
        res.setHeader('X-Debug-Final-Filter', JSON.stringify({ filter: finalFilter, sort }));
      }
      return res.status(200).json(items);
    } catch (err) {
      // Map common cast errors to 400 to avoid 500
      const message = err?.message || 'Request failed';
      if (err?.name === 'CastError' || /Cast to/.test(message)) {
        return res
          .status(400)
          .json({ success: false, message: 'Invalid value provided (list)', details: message });
      }
      return res.status(400).json({ success: false, message: 'Request failed', details: message });
    }
  })
);

/**
 * @swagger
 * /api/session-tracking/{id}:
 *   get:
 *     summary: Get session tracking by ID
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 *       400: { description: Invalid id }
 */
router.get('/:id', asyncHandler(controller.getById));

/**
 * @swagger
 * /api/session-tracking:
 *   post:
 *     summary: Create session tracking record
 *     tags: [SessionTracking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       201: { description: Created }
 *       422: { description: Validation failed }
 *       400: { description: Bad request }
 */
router.post('/', asyncHandler(controller.create));

/**
 * @swagger
 * /api/session-tracking/{id}:
 *   put:
 *     summary: Update session tracking record
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 *       400: { description: Invalid id or payload }
 *       422: { description: Validation failed }
 */
router.put('/:id', asyncHandler(controller.update));

/**
 * @swagger
 * /api/session-tracking/{id}:
 *   delete:
 *     summary: Delete session tracking record
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Not found }
 *       400: { description: Invalid id }
 */
router.delete('/:id', asyncHandler(controller.remove));

/**
 * Simple in-memory cache with TTL for aggregation responses.
 * Keyed by a stringified set of query params.
 */
const histogramCache = new Map();
const HISTOGRAM_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCache(key) {
  const hit = histogramCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    histogramCache.delete(key);
    return null;
  }
  return hit.value;
}
function setCache(key, value) {
  histogramCache.set(key, { value, expiresAt: Date.now() + HISTOGRAM_TTL_MS });
}

/**
 * Build a deterministic cache key for histogram params.
 */
function buildCacheKey(params) {
  const ordered = {
    scope: params.scope || 'all',
    userId: params.userId || null,
    tenantId: params.tenantId || null,
    startDate: params.startDate || null,
    endDate: params.endDate || null,
    binSizeMinutes: Number.isFinite(+params.binSizeMinutes) ? +params.binSizeMinutes : 10,
    status: params.status || 'completed',
  };
  return `duration-hist:${JSON.stringify(ordered)}`;
}

/**
 * Compute percentiles on a numeric array.
 * Returns { count, min, max, median, p90, p95 }
 */
function computePercentiles(values) {
  const n = values.length;
  if (n === 0) {
    return { count: 0, min: null, max: null, median: null, p90: null, p95: null };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const pick = (p) => {
    if (n === 1) return sorted[0];
    const idx = Math.min(n - 1, Math.max(0, Math.floor((p / 100) * (n - 1))));
    return sorted[idx];
  };
  const median = pick(50);
  const p90 = pick(90);
  const p95 = pick(95);
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    median,
    p90,
    p95,
  };
}

/**
 * Helper to validate and parse query params for the histogram endpoint.
 */
function parseHistogramParams(q) {
  const scope = (q.scope === 'user' || q.scope === 'all') ? q.scope : 'all';
  const userId = q.userId ? String(q.userId) : null;
  const tenantId = q.tenantId ? String(q.tenantId) : null;
  const status = q.status ? String(q.status) : 'completed';

  const binSize = parseInt(q.binSizeMinutes, 10);
  const binSizeMinutes = Number.isFinite(binSize) && binSize > 0 ? binSize : 10;

  const startDate = q.startDate ? new Date(q.startDate) : null;
  const endDate = q.endDate ? new Date(q.endDate) : null;

  if (q.startDate && isNaN(startDate)) {
    throw Object.assign(new Error('Invalid startDate'), { status: 400 });
  }
  if (q.endDate && isNaN(endDate)) {
    throw Object.assign(new Error('Invalid endDate'), { status: 400 });
  }
  if (scope === 'user' && !userId) {
    throw Object.assign(new Error('userId is required when scope=user'), { status: 400 });
  }
  return { scope, userId, tenantId, status, startDate, endDate, binSizeMinutes };
}

/**
 * Construct Mongo match filter based on params.
 */
function buildMatchFilter({ scope, userId, tenantId, status, startDate, endDate }) {
  const match = {};
  if (status) match.status = status;
  if (tenantId) match.tenant_id = tenantId;
  if (scope === 'user' && userId) match.user_id = userId;

  // Date filter on session_start
  if (startDate || endDate) {
    match.session_start = {};
    if (startDate) match.session_start.$gte = startDate;
    if (endDate) match.session_start.$lte = endDate;
  }
  return match;
}

/**
 * Build bins from histogram buckets result
 */
function buildBinsFromGroups(groups, binSizeMinutes) {
  // groups: [{ _id: { start: <number> }, count: <int> }]
  const bins = groups
    .map((g) => ({
      start: g._id.start,
      end: g._id.start + binSizeMinutes,
      count: g.count,
    }))
    .sort((a, b) => a.start - b.start);
  return bins;
}

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/duration-histogram
 * Returns histogram bins of session durations (in minutes) with optional filters
 * and summary percentiles. Uses in-memory cache with 5 minute TTL.
 */
router.get(
  '/duration-histogram',
  asyncHandler(async (req, res) => {
    // Parse query params and validate
    let params;
    try {
      params = parseHistogramParams(req.query);
    } catch (e) {
      return res
        .status(e.status || 400)
        .json({ success: false, message: e.message || 'Invalid parameters' });
    }

    // Serve from cache if available
    const cacheKey = buildCacheKey(params);
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const { scope, userId, tenantId, status, startDate, endDate, binSizeMinutes } = params;

    // Build $match filter
    const match = buildMatchFilter(params);

    // Stage 1: project durationMinutes
    const projectStage = {
      $project: {
        durationMinutes: {
          $divide: [{ $subtract: ['$session_end', '$session_start'] }, 60000],
        },
        session_start: 1,
        user_id: 1,
        tenant_id: 1,
        status: 1,
      },
    };

    // Stage 2: filter by duration >= 0 (exclude null/negative)
    const durationFilterStage = { $match: { durationMinutes: { $gte: 0 } } };

    // First aggregation to get min and max
    const minMaxPipeline = [{ $match: match }, projectStage, durationFilterStage, {
      $group: {
        _id: null,
        minDuration: { $min: '$durationMinutes' },
        maxDuration: { $max: '$durationMinutes' },
        count: { $sum: 1 },
      },
    }];

    const [minMax] = await SessionTracking.aggregate(minMaxPipeline).allowDiskUse(true);

    // If no data, return empty response with meta
    if (!minMax || minMax.count === 0 || minMax.minDuration == null || minMax.maxDuration == null) {
      const response = {
        scope,
        userId: userId || null,
        tenantId: tenantId || null,
        dateRange: {
          start: startDate ? new Date(startDate).toISOString() : null,
          end: endDate ? new Date(endDate).toISOString() : null,
        },
        binSizeMinutes,
        bins: [],
        summary: { count: 0, min: null, max: null, median: null, p90: null, p95: null },
      };
      setCache(cacheKey, response);
      return res.status(200).json(response);
    }

    const minD = Math.max(0, Math.floor(minMax.minDuration));
    const maxD = Math.ceil(minMax.maxDuration);
    // Build grouping boundaries
    const groupStage = {
      $group: {
        _id: {
          start: {
            $multiply: [
              { $floor: { $divide: ['$durationMinutes', binSizeMinutes] } },
              binSizeMinutes,
            ],
          },
        },
        count: { $sum: 1 },
      },
    };

    // Pipeline for histogram buckets
    const histogramPipeline = [{ $match: match }, projectStage, durationFilterStage, groupStage];

    const groups = await SessionTracking.aggregate(histogramPipeline).allowDiskUse(true);

    const bins = buildBinsFromGroups(groups, binSizeMinutes);

    // Try to compute percentiles server-side if available; else fallback to client-side (Node)
    // We do a simple fetch of all durations with minimal fields to compute percentiles.
    const durationsDocs = await SessionTracking.aggregate([
      { $match: match },
      projectStage,
      durationFilterStage,
      { $project: { durationMinutes: 1, _id: 0 } },
    ]).allowDiskUse(true);

    const durations = durationsDocs
      .map((d) => (typeof d.durationMinutes === 'number' ? d.durationMinutes : null))
      .filter((v) => Number.isFinite(v));

    const summary = computePercentiles(durations);

    const response = {
      scope,
      userId: userId || null,
      tenantId: tenantId || null,
      dateRange: {
        start: startDate ? new Date(startDate).toISOString() : null,
        end: endDate ? new Date(endDate).toISOString() : null,
      },
      binSizeMinutes,
      bins,
      summary,
    };

    setCache(cacheKey, response);
    return res.status(200).json(response);
  })
);

module.exports = router;
