const express = require('express');
const { asyncHandler, parsePagination } = require('../utils/http');
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
    // Handle currency like "$1.23"
    const cleaned = val.replace(/[^0-9.+-eE]/g, '');
    const n = parseFloat(cleaned);
    return Number.isNaN(n) ? NaN : n;
  }
  // Fallback attempt
  const n = Number(val);
  return Number.isNaN(n) ? NaN : n;
}

/**
 * Normalize and enrich a session document:
 * - Ensure total_cost is a number (default 0 if NaN/undefined)
 * - Ensure cost_history[].total_cost are numbers
 * - Ensure agent_costs values are numbers
 * - Ensure session_data exists and has created_at if present in other timestamp fields
 * - Ensure session_breakdown is an array (may be empty) with normalized duration numbers
 */
function normalizeSessionDoc(doc) {
  // Defensive clone; accept both plain object or Mongoose doc.toObject()-like
  const base = doc && typeof doc.toObject === 'function' ? doc.toObject({ getters: true }) : doc || {};
  const out = { ...base };

  // Normalize identifiers and optional fields to avoid undefined surprises for consumers
  if (out._id != null) out._id = String(out._id);

  // Ensure cost numbers are plain JS numbers
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

  // Ensure session_data object shape
  if (!out.session_data || typeof out.session_data !== 'object') {
    out.session_data = {};
  }
  // Backfill created_at in session_data if missing but available elsewhere
  if (!out.session_data.created_at) {
    const created =
      out.created_at ||
      out.timestamp ||
      out.session_start ||
      (out.session_breakdown && Array.isArray(out.session_breakdown) && out.session_breakdown[0]?.session_start) ||
      null;
    if (created) {
      try {
        out.session_data.created_at = new Date(created);
      } catch {
        // ignore invalid
      }
    }
  }

  // Normalize session_breakdown array (null-safe and tolerant to mixed types)
  if (!Array.isArray(out.session_breakdown)) {
    out.session_breakdown = [];
  } else {
    out.session_breakdown = out.session_breakdown.map((entry) => {
      const e = entry && typeof entry.toObject === 'function' ? entry.toObject() : { ...(entry || {}) };
      if (e && typeof e === 'object') {
        // normalize duration to number if present
        if (e.duration !== undefined) {
          const d = toNumber(e.duration);
          e.duration = Number.isFinite(d) ? d : undefined;
        }
        // Allow Agent to be a string or array; normalize to array if provided
        if (e.Agent && !Array.isArray(e.Agent)) {
          e.Agent = [String(e.Agent)];
        }
        // cast dates if string
        try {
          if (e.session_start) e.session_start = new Date(e.session_start);
          if (e.session_end) e.session_end = new Date(e.session_end);
        } catch {
          // ignore parsing errors
        }
        // Ensure user_id is string when present for consistent client matching
        if (e.user_id != null && typeof e.user_id !== 'string') {
          try {
            e.user_id = String(e.user_id);
          } catch {
            // ignore cast errors
          }
        }
      }
      return e;
    });
  }

  // Compute total_duration_for_user based on session_breakdown filtered by this doc's user_id (string-normalized)
  const thisUserId = out.user_id != null ? String(out.user_id) : null;
  if (thisUserId) {
    const total = Array.isArray(out.session_breakdown)
      ? out.session_breakdown.reduce((acc, s) => {
          const uid = s && s.user_id != null ? String(s.user_id) : null;
          const dur = s && typeof s.duration === 'number' ? s.duration : 0;
          return uid === thisUserId ? acc + (Number.isFinite(dur) ? dur : 0) : acc;
        }, 0)
      : 0;
    out.total_duration_for_user = total;
  } else {
    // If user_id missing, default to 0 for backward-compatible truthy numeric field
    out.total_duration_for_user = 0;
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
 *         description: Successful response (array or envelope based on pagination params).
 *           Each record is enriched with:
 *           - session_breakdown: array of per-phase segments (null-safe; empty array if absent)
 *           - total_duration_for_user: number, sum of segment durations where segment.user_id equals record.user_id
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
 * If JWT is present (as enforced by router mounting), we prefer req.tenantId from middleware.
 * However, we keep the existing behavior to allow explicit tenant_id in query for compatibility
 * in non-auth tool usage. When Authorization is present and tenant_id conflicts, middleware upstream
 * should already block it; here we defensively enforce tenant alias scoping as well.
 */
// PUBLIC_INTERFACE
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Derive tenant: prefer middleware-set req.tenantId; fallback to query/header for legacy behavior.
    const tenantJwt = req?.tenantId ? String(req.tenantId) : null;
    const tenantFromQuery = typeof req.query.tenant_id === 'string' ? req.query.tenant_id.trim() : '';
    const legacyHeaderTenant =
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-tenant'] === 'string' && req.headers['x-tenant'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id'].trim()) ||
      '';
    const tenantFromLegacyQuery =
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) || '';
    const enforcedTenant = tenantJwt || tenantFromQuery || tenantFromLegacyQuery || legacyHeaderTenant || null;

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
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit).lean(),
          SessionTracking.countDocuments(finalFilter),
        ]);

        // Normalize and enrich each doc; ensure session_breakdown present and computed total_duration_for_user
        const items = docs.map((d) => normalizeSessionDoc(d));
        const meta = { page, limit, total };
        if (debugEnabled) meta.debug = { finalFilter, sort, skip, limit };
        const payload = { success: true, data: items, meta };
        slSet(cacheKey, payload);
        return res.status(200).json(payload);
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort).lean();
      const items = docs.map((d) => normalizeSessionDoc(d));
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

// Override getById to normalize/enrich the single document response for Session Details modal
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    try {
      const id = req.params.id;
      const tenant = req?.tenantId ? String(req.tenantId) : undefined;
      const doc = await SessionTracking.findOne(
        tenant
          ? {
              _id: id,
              $or: [
                { tenant_id: tenant },
                { organization_id: tenant },
                { organizationId: tenant },
              ],
            }
          : { _id: id }
      ).lean();
      if (!doc) {
        return res.status(404).json({ success: false, message: 'Not found' });
      }
      const enriched = normalizeSessionDoc(doc);
      return res.status(200).json(enriched);
    } catch (err) {
      const message = err?.message || 'Request failed';
      if (err?.name === 'CastError' || /Cast to/.test(message)) {
        return res.status(400).json({ success: false, message: 'Invalid id', details: message });
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
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
