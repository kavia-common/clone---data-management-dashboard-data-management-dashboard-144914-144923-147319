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

/**
 * PUBLIC_INTERFACE
 * Unified list/details GET /api/session-tracking
 * Supports query params:
 * - page, limit, pageSize: pagination (enables envelope)
 * - sort: sort string
 * - filter: JSON filter (tenant fields inside are ignored)
 * - q: text search across fields
 * - tenant_id | organization_id: tenant scoping (organization_id alias supported)
 * - id: when provided, returns a single session document (or null) with optional session_breakdown filtering
 * - startDate, endDate: when id is present, filters session_breakdown to entries overlapping range (inclusive)
 *
 * Response shape:
 * - When id is not provided:
 *   { success: true, data: [...], meta: { page, limit, total } } for paginated
 *   or raw array when no explicit pagination (kept for backward compatibility)
 *   When no matches: { success: true, data: [], meta: { ... total: 0 } } or []
 * - When id is provided:
 *   { success: true, data: <doc-with-filtered-breakdown> } or { success: true, data: null } if no match
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Normalize tenant alias: organization_id -> tenant_id
    const tenantQuery = (req.query.tenant_id || req.query.organization_id || '').toString().trim();
    const legacyHeaderTenant =
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      '';
    const enforcedTenant = tenantQuery || legacyHeaderTenant || null;

    // Parse pagination and filter (support pageSize alias for limit)
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    const debugEnabled = String(req.query.debug || 'false') === 'true';

    // If id is provided, serve single-session with optional breakdown filtering
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (id) {
      try {
        // Build base find filter with tenant enforcement when provided
        const findFilter = { _id: id };
        if (enforcedTenant) {
          findFilter.$or = [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
            { tenantId: enforcedTenant },
            { 'tenant.tenant_id': enforcedTenant },
          ];
        }

        const doc = await SessionTracking.findOne(findFilter).lean();
        if (!doc) {
          // Do not return 404; return success:true, data:null
          return res.status(200).json({ success: true, data: null });
        }

        // Validate date filters
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

        const breakdown = Array.isArray(doc.session_breakdown) ? doc.session_breakdown.slice() : [];

        // Filter breakdown for overlap with [startMs, endMs] inclusive
        const filtered = breakdown.filter((seg) => {
          const s = seg?.session_start ? new Date(seg.session_start).getTime() : null;
          const e = seg?.session_end ? new Date(seg.session_end).getTime() : null;

          if (startMs == null && endMs == null) return true;
          const segStart = Number.isFinite(s) ? s : null;
          const segEnd = Number.isFinite(e) ? e : segStart;
          if (segStart == null && segEnd == null) return false;

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

        // Compute total duration seconds from filtered segments
        const computeSegDurationSeconds = (seg) => {
          const d = Number(seg?.duration);
          if (Number.isFinite(d) && d >= 0) return d;
          const s = seg?.session_start ? new Date(seg.session_start).getTime() : NaN;
          const e = seg?.session_end ? new Date(seg.session_end).getTime() : NaN;
          if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) {
            return Math.floor((e - s) / 1000);
          }
          return 0;
        };
        const totalDurationSeconds = filtered.reduce((acc, seg) => acc + computeSegDurationSeconds(seg), 0);

        const out = {
          ...doc,
          session_breakdown: filtered,
          session_breakdown_total_duration_seconds: totalDurationSeconds,
        };
        return res.status(200).json({ success: true, data: out });
      } catch (err) {
        const message = err?.message || 'Request failed';
        if (err?.name === 'CastError' || /Cast to/.test(message)) {
          return res.status(400).json({ success: false, message: 'Invalid id', details: message });
        }
        return res.status(400).json({ success: false, message: 'Request failed', details: message });
      }
    }

    // LIST MODE
    // Require tenant scope for list. We keep prior behavior: tenant is required to avoid cross-tenant leakage.
    if (!enforcedTenant) {
      return res.status(400).json({
        success: false,
        message:
          'tenant_id is required. Provide ?tenant_id=... (alias organization_id; legacy headers supported).',
      });
    }

    // New: user-centric listing of breakdown entries across sessions
    const userIdFilter =
      typeof req.query.user_id === 'string'
        ? req.query.user_id.trim()
        : typeof req.query['user/_id'] === 'string'
        ? req.query['user/_id'].trim()
        : '';

    if (userIdFilter) {
      // Build base filter scoped by tenant and matching breakdown subdocs for user_id
      const matchStage = {
        $and: [
          {
            $or: [
              { tenant_id: enforcedTenant },
              { organization_id: enforcedTenant },
              { organizationId: enforcedTenant },
              { tenantId: enforcedTenant },
              { 'tenant.tenant_id': enforcedTenant },
            ],
          },
          { session_breakdown: { $elemMatch: { user_id: userIdFilter } } },
        ],
      };

      try {
        // Aggregation: find matching sessions, unwind breakdown, filter to only entries for user_id
        const pipeline = [
          { $match: matchStage },
          { $sort: { session_start: -1 } },
          { $unwind: { path: '$session_breakdown', preserveNullAndEmptyArrays: false } },
          { $match: { 'session_breakdown.user_id': userIdFilter } },
          {
            $project: {
              _id: 0,
              session_id: '$_id',
              session_start: '$session_breakdown.session_start',
              session_end: '$session_breakdown.session_end',
              duration: '$session_breakdown.duration',
              agents: '$session_breakdown.Agents',
              user_id: '$session_breakdown.user_id',
            },
          },
        ];

        // Count total flattened entries for pagination
        const totalAgg = await SessionTracking.aggregate([
          { $match: matchStage },
          { $unwind: { path: '$session_breakdown', preserveNullAndEmptyArrays: false } },
          { $match: { 'session_breakdown.user_id': userIdFilter } },
          { $count: 'total' },
        ]);
        const total = totalAgg?.[0]?.total || 0;

        const items = await SessionTracking.aggregate([
          ...pipeline,
          { $skip: skip },
          { $limit: limit },
        ]);

        // Normalize fields and ensure duration is numeric seconds; agents is array
        const normItems = items.map((it) => {
          let d = Number(it.duration);
          if (!Number.isFinite(d) || d < 0) {
            const s = it.session_start ? new Date(it.session_start).getTime() : NaN;
            const e = it.session_end ? new Date(it.session_end).getTime() : NaN;
            d = !Number.isNaN(s) && !Number.isNaN(e) && e >= s ? Math.floor((e - s) / 1000) : 0;
          }
          const agents = Array.isArray(it.agents) ? it.agents : [];
          return {
            session_id: String(it.session_id),
            session_start: it.session_start || null,
            session_end: it.session_end || null,
            duration: d,
            agents,
            user_id: it.user_id != null ? String(it.user_id) : null,
          };
        });

        // Return concise envelope per requirement
        return res.status(200).json({
          success: true,
          items: normItems,
          total,
        });
      } catch (err) {
        const message = err?.message || 'Request failed';
        return res.status(400).json({ success: false, message: 'Request failed', details: message });
      }
    }

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
          { user_name: regex },
          { User_name: regex },
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
    }

    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let filter = {};
    try {
      filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }

    // Remove tenant bypass attempts
    if (filter && typeof filter === 'object') {
      delete filter.organization_id;
      delete filter.tenant_id;
      delete filter.organizationId;
      if (Array.isArray(filter.$or)) delete filter.$or;
    }

    const enforcedScope = enforcedTenant
      ? {
          $or: [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
          ],
        }
      : {};

    const combined = q && qFilter.$or && qFilter.$or.length > 0 ? { $and: [filter, qFilter] } : filter;
    const finalFilter =
      Object.keys(enforcedScope).length > 0 ? { $and: [combined, enforcedScope] } : combined;

    try {
      if (explicit) {
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
