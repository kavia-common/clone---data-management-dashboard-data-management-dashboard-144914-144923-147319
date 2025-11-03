const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

// In-memory TTL cache for distinct endpoints
const DISTINCT_TTL_MS = 60 * 1000; // 60s short-lived cache
const distinctCache = new Map();
function dcGet(key) {
  const v = distinctCache.get(key);
  if (!v) return null;
  if (Date.now() > v.expiresAt) {
    distinctCache.delete(key);
    return null;
  }
  return v.value;
}
function dcSet(key, value) {
  distinctCache.set(key, { value, expiresAt: Date.now() + DISTINCT_TTL_MS });
}

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
 *         description: JSON filter (e.g., {"tenant_id":"org1","status":"active"})
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: >
 *           Case-insensitive text search applied across multiple fields:
 *           task_id, tenant_id, organization_name, user_name, project_id, container_id,
 *           service_type, status, and session_data fields (session_name, description, llm_model).
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO start datetime (inclusive) applied to session_start/last_updated
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO end datetime (inclusive) applied to session_start/last_updated
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
    // Parse pagination and filter (support pageSize alias for limit)
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    let sort = req.query.sort || '-session_start';
    // Validate sort to avoid injection of complex expressions
    if (typeof sort !== 'string') sort = '-session_start';
    // Whitelist sortable fields
    const allowedSort = new Set([
      'session_start','-session_start',
      'last_updated','-last_updated',
      'created_at','-created_at',
      'tenant_id','-tenant_id',
      'status','-status',
      'user_name','-user_name',
      'project_id','-project_id',
      'total_cost','-total_cost'
    ]);
    if (!allowedSort.has(sort)) sort = '-session_start';

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

    // Apply specific filters: user_name (case-insensitive exact) and tenant_id (exact)
    // Accept alias "User_name" as well; normalize into Mongo filter operators.
    if (filter && typeof filter === 'object') {
      const userNameVal = filter.user_name ?? filter.User_name;
      if (typeof userNameVal === 'string' && userNameVal.trim() !== '') {
        const exactCI = new RegExp(`^${userNameVal.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        // Match either underlying field user_name or alias
        // Mongoose alias means storing in user_name; use $or to be safe for legacy docs
        filter = {
          ...filter,
          $and: [
            ...(filter.$and || []),
            { $or: [{ user_name: exactCI }, { User_name: exactCI }] },
          ],
        };
        delete filter.user_name;
        delete filter.User_name;
      }
      const tenantIdVal = filter.tenant_id;
      if (typeof tenantIdVal === 'string' && tenantIdVal.trim() !== '') {
        // exact match, already normalized by leaving as-is
        // nothing to change
      }
    }

    // Apply date range: startDate/endDate on session_start/last_updated (inclusive)
    const startStr = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : '';
    const endStr = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : '';
    let dateFilter = null;
    if (startStr || endStr) {
      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : null;
      if (startStr && Number.isNaN(start?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid startDate' });
      }
      if (endStr && Number.isNaN(end?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid endDate' });
      }
      const r = {};
      if (start) r.$gte = start;
      if (end) r.$lte = end;
      dateFilter = { $or: [{ session_start: r }, { last_updated: r }] };
    }

    // Combine filters
    let finalFilter =
      q && qFilter.$or && qFilter.$or.length > 0 ? { $and: [filter, qFilter] } : filter;
    if (dateFilter) {
      finalFilter = finalFilter && Object.keys(finalFilter).length
        ? { $and: [finalFilter, dateFilter] }
        : dateFilter;
    }

    try {
      // Optimize projection to only the fields needed for charts/table
      const projection = {
        _id: 1,
        tenant_id: 1,
        organization_name: 1,
        user_id: 1,
        user_name: 1,
        User_name: 1,
        service_type: 1,
        project_id: 1,
        status: 1,
        total_cost: 1,
        session_start: 1,
        last_updated: 1,
        'session_data.session_name': 1,
        'session_data.llm_model': 1,
      };

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
          SessionTracking.find(finalFilter, projection).sort(sort).skip(skip).limit(limit).lean(),
          SessionTracking.countDocuments(finalFilter),
        ]);
        const items = docs.map((d) => normalizeSessionDoc(d));
        const payload = { success: true, data: items, meta: { page, limit, total } };
        slSet(cacheKey, payload);
        return res.status(200).json(payload);
      }

      const docs = await SessionTracking.find(finalFilter, projection).sort(sort).lean();
      const items = docs.map((d) => normalizeSessionDoc(d));
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

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/distinct
 * Returns distinct values of a specified field from session_tracking.
 * Query params:
 *  - field: required; one of "User_name" or "tenant_id"
 *  - start/end or startDate/endDate: optional date range (applied to session_start/last_updated)
 *  - filter: optional JSON for scoping (supports user_name/User_name and tenant_id like list endpoint)
 *
 * Returns: { items: string[], total: number }
 */
router.get(
  '/distinct',
  asyncHandler(async (req, res) => {
    const field = String(req.query.field || '').trim();
    if (!field) {
      return res.status(400).json({ success: false, message: 'field query param is required' });
    }

    // Only allow known fields
    const allowed = new Set(['User_name', 'tenant_id']);
    if (!allowed.has(field)) {
      return res.status(400).json({ success: false, message: 'Unsupported field. Use User_name or tenant_id' });
    }

    // Build base filter (reuse same logic as list)
    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let filter = {};
    try {
      filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Normalize user_name alias and exact CI matching if provided in filter
    if (filter && typeof filter === 'object') {
      const userNameVal = filter.user_name ?? filter.User_name;
      if (typeof userNameVal === 'string' && userNameVal.trim() !== '') {
        const exactCI = new RegExp(`^${userNameVal.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        filter = {
          ...filter,
          $and: [
            ...(filter.$and || []),
            { $or: [{ user_name: exactCI }, { User_name: exactCI }] },
          ],
        };
        delete filter.user_name;
        delete filter.User_name;
      }
    }

    // Date range on session_start/last_updated
    const startStr = typeof req.query.startDate === 'string' ? req.query.startDate.trim() : (typeof req.query.start === 'string' ? req.query.start.trim() : '');
    const endStr = typeof req.query.endDate === 'string' ? req.query.endDate.trim() : (typeof req.query.end === 'string' ? req.query.end.trim() : '');
    let dateFilter = null;
    if (startStr || endStr) {
      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : null;
      if (startStr && Number.isNaN(start?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start/startDate' });
      }
      if (endStr && Number.isNaN(end?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid end/endDate' });
      }
      const r = {};
      if (start) r.$gte = start;
      if (end) r.$lte = end;
      dateFilter = { $or: [{ session_start: r }, { last_updated: r }] };
    }

    let finalFilter = filter;
    if (dateFilter) {
      finalFilter = finalFilter && Object.keys(finalFilter).length
        ? { $and: [finalFilter, dateFilter] }
        : dateFilter;
    }

    // Field mapping: allow "User_name" alias but query the correct stored field as well
    const distinctFields = field === 'User_name' ? ['User_name', 'user_name'] : [field];

    try {
      // Cache key
      const cacheKey = `distinct:${field}:${JSON.stringify(finalFilter || {})}:${startStr || ''}:${endStr || ''}`;
      const cached = dcGet(cacheKey);
      if (cached) {
        return res.status(200).json({ items: cached, total: cached.length, success: true, cached: true });
      }

      // Use aggregation to get distinct values across possible casing/alias fields
      const matchStage = { $match: finalFilter || {} };
      const projectStage =
        field === 'User_name'
          ? {
              $project: {
                // Prefer stored user_name, then alias; guard against null/undefined
                value: {
                  $let: {
                    vars: { u: { $ifNull: ['$user_name', '$User_name'] } },
                    in: {
                      $cond: [
                        { $and: [{ $ne: ['$$u', null] }, { $ne: ['$$u', ''] }] },
                        { $toString: '$$u' },
                        ''
                      ]
                    }
                  }
                },
              },
            }
          : {
              $project: {
                value: {
                  $let: {
                    vars: { v: { $ifNull: [`$${field}`, ''] } },
                    in: {
                      $cond: [
                        { $and: [{ $ne: ['$$v', null] }, { $ne: ['$$v', ''] }] },
                        { $toString: '$$v' },
                        ''
                      ]
                    }
                  }
                }
              },
            };

      const pipeline = [
        matchStage,
        projectStage,
        { $match: { value: { $type: 'string', $ne: '' } } },
        { $group: { _id: '$value' } },
        { $replaceRoot: { newRoot: { value: '$_id' } } },
        { $sort: { value: 1 } },
        { $limit: 1000 },
      ];

      const docs = await SessionTracking.aggregate(pipeline).allowDiskUse(true);
      const items = docs.map((d) => d.value);
      dcSet(cacheKey, items);
      return res.status(200).json({ items, total: items.length, success: true });
    } catch (err) {
      const message = err?.message || 'Failed to compute distinct values';
      return res.status(400).json({ success: false, message, details: message });
    }
  })
);

/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/features-usage
 * Aggregates feature usage counts from session_tracking using service_type as the primary feature dimension,
 * with a tolerant mapping that can enrich/derive feature names from llm_model or session_data.session_name if available.
 *
 * Query parameters:
 * - startDate/endDate: ISO date (inclusive), applied to created_at/last_updated (indexed) for early $match
 * - user_name: case-insensitive exact match using user_name_lower (indexed); alternatively filter.user_name or filter.User_name in JSON
 * - tenant_id: exact match
 * - status: optional exact match
 * - limit: number of top/bottom entries to return (default 5, max 50)
 * - minCount: minimum count threshold to include in results (default 1) to reduce noise
 *
 * Response 200:
 * {
 *   success: true,
 *   mostUsed: [{ feature: string, count: number }],
 *   leastUsed: [{ feature: string, count: number }],
 *   meta: { totalDistinct: number, applied: { startDate, endDate, tenant_id, user_name, status, limit, minCount } }
 * }
 */
router.get(
  '/features-usage',
  asyncHandler(async (req, res) => {
    // Parse and validate params
    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 5;

    // Optional includeEmpty flag (default false)
    const includeEmpty = String(req.query.includeEmpty || 'false').toLowerCase() === 'true';

    // Accept aliases start/end as well, prefer startDate/endDate
    const startStr =
      (typeof req.query.startDate === 'string' && req.query.startDate.trim()) ||
      (typeof req.query.start === 'string' && req.query.start.trim()) ||
      '';
    const endStr =
      (typeof req.query.endDate === 'string' && req.query.endDate.trim()) ||
      (typeof req.query.end === 'string' && req.query.end.trim()) ||
      '';

    // Filters: tenant_id, user_id, user_name (case-insensitive)
    const tenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : '';
    const userName = typeof req.query.user_name === 'string' ? req.query.user_name.trim() : '';

    // Build early $match
    const match = {};
    if (tenantId) match.tenant_id = tenantId;
    if (userId) match.user_id = userId;
    if (!userId && userName) match.user_name_lower = userName.toLowerCase();

    if (startStr || endStr) {
      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : null;
      if (startStr && Number.isNaN(start?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid startDate/start' });
      }
      if (endStr && Number.isNaN(end?.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid endDate/end' });
      }
      const r = {};
      if (start) r.$gte = start;
      if (end) r.$lte = end;
      // Inclusive UTC date range: apply to created_at OR last_updated for better index usage
      match.$or = [{ created_at: r }, { last_updated: r }];
    }

    // Dev log for quick verification (request URL and expected limit)
    if (process.env.NODE_ENV !== 'production') {
      try {
        const usp = new URLSearchParams({
          ...(startStr ? { startDate: startStr } : {}),
          ...(endStr ? { endDate: endStr } : {}),
          ...(tenantId ? { tenant_id: tenantId } : {}),
          ...(userId ? { user_id: userId } : {}),
          ...(userName ? { user_name: userName } : {}),
          limit: String(limit),
        });
        // eslint-disable-next-line no-console
        console.debug(`[features-usage] GET /api/session-tracking/features-usage?${usp.toString()}`);
      } catch {
        // ignore logging errors
      }
    }

    // Aggregation: group by service_type (with optional inclusion of empty/null)
    const pipeline = [
      { $match: match },
      {
        $project: {
          service_type: 1,
        },
      },
      // Optionally drop null/empty when includeEmpty=false
      ...(includeEmpty ? [] : [{ $match: { service_type: { $type: 'string', $ne: '' } } }]),
      {
        $group: {
          _id: '$service_type',
          count: { $sum: 1 },
        },
      },
    ];

    const groups = await SessionTracking.aggregate(pipeline).allowDiskUse(true);

    // Map to desired shape { feature, count }
    const arr = (groups || [])
      .map((g) => ({
        feature: (g?._id ?? '') === '' ? 'unknown' : String(g._id),
        count: g?.count || 0,
      }));

    // Sort for most/least used
    const mostUsed = arr.slice().sort((a, b) => b.count - a.count).slice(0, limit);
    const leastUsed = arr.slice().sort((a, b) => a.count - b.count || a.feature.localeCompare(b.feature)).slice(0, limit);

    // Dev log: response length
    if (process.env.NODE_ENV !== 'production') {
      try {
        // eslint-disable-next-line no-console
        console.debug(`[features-usage] response sizes: total=${arr.length}, most=${mostUsed.length}, least=${leastUsed.length}`);
      } catch {
        // ignore
      }
    }

    return res.status(200).json({
      mostUsed,
      leastUsed,
      meta: { totalDistinct: arr.length },
    });
  })
);

module.exports = router;
