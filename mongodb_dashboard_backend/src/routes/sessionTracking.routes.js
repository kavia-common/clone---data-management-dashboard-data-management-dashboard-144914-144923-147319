const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
// Use the existing generic CRUD factory with tenant enforcement
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
// Build controller for SessionTracking with default sort by -session_start
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
/**
 * PUBLIC_INTERFACE
 * GET /api/session-tracking/:id/details
 * Returns session details including session_breakdown. Optional query params:
 * - startDate: ISO date string (inclusive)
 * - endDate: ISO date string (inclusive)
 * Filters session_breakdown items where item.session_start/session_end overlap the provided range.
 */
/**
 * @swagger
 * /api/session-tracking/{id}/details:
 *   get:
 *     summary: Get session details including breakdown
 *     description: Returns a session document with session_breakdown. Optional date filters (startDate, endDate) filter breakdown entries by their time range overlap.
 *     tags: [SessionTracking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: startDate
 *         required: false
 *         schema: { type: string, format: date-time }
 *         description: Inclusive ISO start datetime. If only this is provided, filters [startDate, +infinity).
 *       - in: query
 *         name: endDate
 *         required: false
 *         schema: { type: string, format: date-time }
 *         description: Inclusive ISO end datetime. If only this is provided, filters (-infinity, endDate].
 *       - in: query
 *         name: organization_id
 *         required: false
 *         schema: { type: string }
 *         description: Optional tenant scope when multi-tenant fields exist. Alias: tenant_id.
 *       - in: query
 *         name: tenant_id
 *         required: false
 *         schema: { type: string }
 *         description: Optional alias for organization_id.
 *     responses:
 *       200:
 *         description: Session details with filtered breakdown and session_breakdown_total_duration_seconds (seconds).
 *       400:
 *         description: Invalid parameters (e.g., startDate > endDate or invalid ISO date).
 *       404:
 *         description: Session not found
 */
router.get(
  '/:id/details',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    try {
      // Resolve optional tenant/organization scope
      const tenantFromQuery =
        (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
        (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
        null;

      // Determine applied tenant: prefer req.tenantId (from auth) else optional query alias if provided
      const appliedTenant =
        (req.tenantId && String(req.tenantId)) || (tenantFromQuery ? String(tenantFromQuery) : null);

      // Build base find filter
      const findFilter = { _id: id };
      if (appliedTenant) {
        // Support multiple schema aliases without failing if field does not exist
        findFilter.$or = [
          { tenant_id: appliedTenant },
          { organization_id: appliedTenant },
          { organizationId: appliedTenant },
          { tenantId: appliedTenant },
          { 'tenant.tenant_id': appliedTenant },
        ];
      }

      const doc = await SessionTracking.findOne(findFilter).lean();
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Session not found' });
      }

      // Validate and parse date query params
      const { startDate, endDate } = req.query;
      const hasStart = typeof startDate === 'string' && startDate.trim().length > 0;
      const hasEnd = typeof endDate === 'string' && endDate.trim().length > 0;

      let startMs = null;
      let endMs = null;

      if (hasStart) {
        const d = new Date(startDate);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid startDate. Expect ISO date-time.',
          });
        }
        startMs = d.getTime();
      }
      if (hasEnd) {
        const d = new Date(endDate);
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid endDate. Expect ISO date-time.',
          });
        }
        endMs = d.getTime();
      }

      if (startMs !== null && endMs !== null && startMs > endMs) {
        return res.status(400).json({
          success: false,
          message: 'startDate must be less than or equal to endDate',
        });
      }

      const clone = { ...doc };
      const breakdown = Array.isArray(doc.session_breakdown) ? doc.session_breakdown.slice() : [];

      // Include segments that overlap [startMs, endMs]
      const filtered = breakdown.filter((seg) => {
        const s = seg?.session_start ? new Date(seg.session_start).getTime() : null;
        const e = seg?.session_end ? new Date(seg.session_end).getTime() : null;

        // No filters provided -> include all
        if (startMs == null && endMs == null) return true;

        // Normalize segment times; if both missing skip
        const segStart = Number.isFinite(s) ? s : null;
        const segEnd = Number.isFinite(e) ? e : segStart;
        if (segStart == null && segEnd == null) return false;

        // Overlap logic with inclusive ends
        if (startMs != null && endMs != null) {
          return (segStart ?? segEnd) <= endMs && (segEnd ?? segStart) >= startMs;
        }
        if (startMs != null) {
          return (segEnd ?? segStart) >= startMs;
        }
        if (endMs != null) {
          return (segStart ?? segEnd) <= endMs;
        }
        return true;
      });

      // Keep duration unit in seconds as provided when valid; fallback to compute from timestamps
      function computeSegDurationSeconds(seg) {
        const d = Number(seg?.duration);
        if (Number.isFinite(d) && d >= 0) return d;
        const s = seg?.session_start ? new Date(seg.session_start).getTime() : NaN;
        const e = seg?.session_end ? new Date(seg.session_end).getTime() : NaN;
        if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) {
          return Math.floor((e - s) / 1000);
        }
        return 0;
      }

      const totalDurationSeconds = filtered.reduce(
        (acc, seg) => acc + computeSegDurationSeconds(seg),
        0
      );

      clone.session_breakdown = filtered;
      clone.session_breakdown_total_duration_seconds = totalDurationSeconds;

      return res.status(200).json(clone);
    } catch (err) {
      const message = err?.message || 'Request failed';
      if (err?.name === 'CastError' || /Cast to/.test(message)) {
        return res.status(400).json({ success: false, message: 'Invalid id', details: message });
      }
      return res.status(400).json({ success: false, message: 'Request failed', details: message });
    }
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
