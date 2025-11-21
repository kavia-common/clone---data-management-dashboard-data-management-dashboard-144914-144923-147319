const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { isValidISODate, parseISODateSafe } = require('../utils/date');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * @swagger
 * tags:
 *   name: SessionTracking
 *   description: Session tracking collection endpoints
 */

/**
 * List session tracking records.
 * Accepts: page, limit, tenant_id, start, end, filter, sort, q
 * Filters results between session_start >= start and session_start <= end if provided.
 * Deprecated: from, to (NO LONGER SUPPORTED -- only start/end valid).
 *
 * Behavior notes:
 * - No default date filter for paginated requests; only last-30-days applied for non-paginated requests to protect payload size.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Resolve tenant from middleware if available; keep legacy fallbacks for safety
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    if (!enforcedTenant) {
      return res.status(400).json({
        success: false,
        message:
          'tenant_id is required. Provide ?tenant_id=... (or header x-organization-id / x-tenant-id).',
      });
    }

    // Pagination and filter logic
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // Text search
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

    // Backwards compatible: filter (JSON or string) with tenant guard
    const filterRaw = req.query.filter ? req.query.filter : '{}';
    let filter = {};
    try {
      filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
    }
    // Remove legacy tenant keys (always imposed server-side)
    if (filter && typeof filter === 'object') {
      delete filter.organization_id;
      delete filter.tenant_id;
      delete filter.organizationId;
      if (Array.isArray(filter.$or)) delete filter.$or;
    }

    // Tenant scoping (always $or match all possible schema fields for org/tenant)
    const enforcedScope = enforcedTenant
      ? {
          $or: [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
          ],
        }
      : {};

    // CONDITIONAL TIME FILTERING
    // - hasDateParams: when start/end provided, normalize and apply as filter on session_start.
    // - explicit pagination (page/limit present) WITHOUT start/end: DO NOT apply default 30-day filter; return full history for the tenant.
    // - non-paginated requests WITHOUT start/end: apply default 30-day window to protect raw responses from unbounded results.
    const hasDateParams = Boolean(req.query.start || req.query.end);

    let timeFilter = {};
    const now = new Date();
    const DEFAULT_WINDOW_DAYS = 30;

    if (hasDateParams) {
      // Normalize provided start/end and use inclusive end-of-day for 'end'
      let start = null;
      let end = null;

      if (req.query.start && isValidISODate(req.query.start)) {
        start = parseISODateSafe(req.query.start);
      }
      if (req.query.end && isValidISODate(req.query.end)) {
        const parsedEnd = parseISODateSafe(req.query.end);
        parsedEnd.setUTCHours(23, 59, 59, 999);
        end = parsedEnd;
      }

      // Fill missing bounds if only one provided
      if (!start && !end) {
        // Safety fallback: shouldn't happen due to hasDateParams true, but keep guard
        const guardEnd = now;
        const guardStart = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        timeFilter = { session_start: { $gte: guardStart, $lte: guardEnd } };
      } else if (start && !end) {
        timeFilter = { session_start: { $gte: start, $lte: now } };
      } else if (!start && end) {
        const computedStart = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
        timeFilter = { session_start: { $gte: computedStart, $lte: end } };
      } else {
        timeFilter = { session_start: { $gte: start, $lte: end } };
      }
    } else if (!explicit) {
      // No date params and NOT paginated -> apply default last 30 days window
      const start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const end = now;
      timeFilter = { session_start: { $gte: start, $lte: end } };
    } else {
      // explicit pagination without dates -> no time filter (full history within tenant)
      timeFilter = {};
    }

    // Combine filters: base filter + search + tenant scope + time
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
    if (!isEmpty(filter)) parts.push(filter);
    if (!isEmpty(qFilter)) parts.push(qFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
    if (!isEmpty(timeFilter)) parts.push(timeFilter);

    const finalFilter = parts.length > 1 ? { $and: parts } : parts[0] || {};

    // Optional debug logging of the final filter; controlled by env (default off)
    // Set REACT_APP_LOG_LEVEL=debug to enable. Note: not enabled by default.
    const enableDebug = String(process.env.REACT_APP_LOG_LEVEL || '').toLowerCase() === 'debug';
    if (enableDebug) {
      try {
        // eslint-disable-next-line no-console
        console.debug('[session-tracking] finalFilter=', JSON.stringify(finalFilter));
      } catch (_) {}
    }

    // Ready to query
    try {
      if (explicit) {
        // meta.total reflects the same finalFilter. Since we drop the default time filter
        // for explicit pagination without start/end, total will represent full tenant history.
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);
        return res.json({ success: true, data: docs, meta: { page, limit, total } });
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      return res.json(docs);
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

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
