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
 *         description: JSON filter (e.g., {"tenant_id":"org1","status":"active"})
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
// PUBLIC_INTERFACE
router.get(
  '/',
  asyncHandler(async (req, res) => {
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

    // Combine filters
    const finalFilter =
      q && qFilter.$or && qFilter.$or.length > 0 ? { $and: [filter, qFilter] } : filter;

    try {
      if (explicit) {
        const [docs, total] = await Promise.all([
          // Use model documents (no lean) so Mongoose applies basic casting; still normalize to be safe
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);
        const items = docs.map((d) => normalizeSessionDoc(d.toObject({ getters: true })));
        return res.status(200).json({ success: true, data: items, meta: { page, limit, total } });
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      const items = docs.map((d) => normalizeSessionDoc(d.toObject({ getters: true })));
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

module.exports = router;
