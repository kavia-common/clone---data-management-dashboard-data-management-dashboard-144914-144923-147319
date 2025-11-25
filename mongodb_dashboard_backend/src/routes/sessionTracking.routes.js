// const express = require('express');
// const { asyncHandler } = require('../utils/http');
// const { parsePagination } = require('../utils/http');
// const SessionTracking = require('../models/sessionTracking.model');
// const { buildCrudController } = require('../controllers/crudFactory');
// const { isValidISODate, parseISODateSafe } = require('../utils/date');

// const router = express.Router();
// const controller = buildCrudController(SessionTracking, '-session_start');

// /**
//  * @swagger
//  * tags:
//  *   name: SessionTracking
//  *   description: Session tracking collection endpoints
//  */

// /**
//  * List session tracking records.
//  * Accepts: page, limit, tenant_id, start, end, filter, sort, q
//  * Filters results between session_start >= start and session_start <= end if provided.
//  * Deprecated: from, to (NO LONGER SUPPORTED -- only start/end valid).
//  */
// router.get(
//   '/',
//   asyncHandler(async (req, res) => {
//     // Resolve tenant from middleware if available; keep legacy fallbacks for safety
//     const enforcedTenant = req.tenantId ||
//       (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
//       (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
//       (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
//       (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
//       null;

//     if (!enforcedTenant) {
//       return res.status(400).json({
//         success: false,
//         message:
//           'tenant_id is required. Provide ?tenant_id=... (or header x-organization-id / x-tenant-id).',
//       });
//     }

//     // Pagination and filter logic
//     const rawQuery = { ...req.query };
//     if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;
//     const { page, limit, skip, explicit } = parsePagination(rawQuery);
//     const sort = req.query.sort || '-session_start';

//     // Text search
//     const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
//     let qFilter = {};
//     if (q) {
//       const regex = new RegExp(q, 'i');
//       qFilter = {
//         $or: [
//           { task_id: regex },
//           { tenant_id: regex },
//           { organization_name: regex },
//           { user_name: regex },
//           { User_name: regex },
//           { project_id: regex },
//           { container_id: regex },
//           { service_type: regex },
//           { status: regex },
//           { user_id: regex },
//           { 'session_data.session_name': regex },
//           { 'session_data.description': regex },
//           { 'session_data.llm_model': regex },
//         ],
//       };
//     }

//     // Backwards compatible: filter (JSON or string) with tenant guard
//     const filterRaw = req.query.filter ? req.query.filter : '{}';
//     let filter = {};
//     try {
//       filter = typeof filterRaw === 'string' ? JSON.parse(filterRaw) : filterRaw;
//     } catch {
//       return res.status(400).json({ success: false, message: 'Invalid filter JSON' });
//     }
//     // Remove legacy tenant keys (always imposed server-side)
//     if (filter && typeof filter === 'object') {
//       delete filter.organization_id;
//       delete filter.tenant_id;
//       delete filter.organizationId;
//       if (Array.isArray(filter.$or)) delete filter.$or;
//     }

//     // Tenant scoping (always $or match all possible schema fields for org/tenant)
//     const enforcedScope = enforcedTenant
//       ? {
//           $or: [
//             { tenant_id: enforcedTenant },
//             { organization_id: enforcedTenant },
//             { organizationId: enforcedTenant },
//           ],
//         }
//       : {};

//     // NEW: Accept only start/end for date filtering
//     let start = null;
//     let end = null;
//     const now = new Date();
//     const DEFAULT_WINDOW_DAYS = 30;
//     if (req.query.start || req.query.end) {
//       if (req.query.start && isValidISODate(req.query.start)) {
//         start = parseISODateSafe(req.query.start);
//       }
//       if (req.query.end && isValidISODate(req.query.end)) {
//         // The backend expects inclusive end-of-day as in previous implementation
//         const parsedEnd = parseISODateSafe(req.query.end);
//         parsedEnd.setUTCHours(23, 59, 59, 999);
//         end = parsedEnd;
//       }
//     }
//     // If either is missing, fallback to default 30d window
//     if (!start && !end) {
//       end = now;
//       start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
//     } else if (start && !end) {
//       end = now; // until now
//     } else if (!start && end) {
//       start = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
//     }
//     // Date filter applied to session_start only
//     const timeFilter = {
//       session_start: { $gte: start, $lte: end },
//     };

//     // Combine filters: base filter + search + tenant scope + time
//     const parts = [];
//     const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);
//     if (!isEmpty(filter)) parts.push(filter);
//     if (!isEmpty(qFilter)) parts.push(qFilter);
//     if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
//     if (!isEmpty(timeFilter)) parts.push(timeFilter);

//     const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

//     // Ready to query
//     try {
//       if (explicit) {
//         const [docs, total] = await Promise.all([
//           SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
//           SessionTracking.countDocuments(finalFilter)
//         ]);
//         return res.json({ success: true, data: docs, meta: { page, limit, total } });
//       }

//       const docs = await SessionTracking.find(finalFilter).sort(sort);
//       return res.json(docs);
//     } catch (err) {
//       const message = err?.message || "Request failed";
//       if (err?.name === "CastError" || /Cast to/.test(message)) {
//         return res.status(400).json({ success: false, message: "Invalid value provided (list)", details: message });
//       }
//       return res.status(400).json({ success: false, message: "Request failed", details: message });
//     }
//   })
// );

// router.get('/:id', asyncHandler(controller.getById));
// router.post('/', asyncHandler(controller.create));
// router.put('/:id', asyncHandler(controller.update));
// router.delete('/:id', asyncHandler(controller.remove));

// module.exports = router;

const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { isValidISODate, parseISODateSafe } = require('../utils/date');

const router = express.Router();
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * Early bypass detector for GET /api/session-tracking
 */
function sessionsEarlyBypassDetector(req, res, next) {
  if (req.method !== 'GET' || req.path !== '/') return next();

  const qOrg = typeof req.query?.organization_id === 'string' ? req.query.organization_id : undefined;
  const qTenant = typeof req.query?.tenant_id === 'string' ? req.query.tenant_id : undefined;

  const hdrOrg =
    (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id']) ||
    (typeof req.headers['x-org-id'] === 'string' && req.headers['x-org-id']) ||
    (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id']) ||
    undefined;

  const authTenant =
    (typeof req?.auth?.tenantId === 'string' && req.auth.tenantId) ||
    (typeof req?.auth?.organization_id === 'string' && req.auth.organization_id) ||
    undefined;

  const requestedTenant = hdrOrg || qOrg || qTenant || authTenant;
  const isT0000 = requestedTenant === 'T0000';

  if (isT0000) {
    req.tenantScopeDisabled = true;
    req.allTenants = true;
    req.sessionsAllTenantsBypass = true;

    res.set('X-Tenant-Bypass', 'true');
    res.set('X-Requested-Tenant', 'T0000');
    res.set('X-All-Tenants', 'true');
    res.set('X-Applied-Tenant', 'all-tenants');
  }

  return next();
}

/**
 * Diagnostic headers middleware
 */
router.use((req, res, next) => {
  try {
    if (req.tenantScopeDisabled || req.allTenants) {
      res.set('X-All-Tenants', 'true');
      res.set('X-Applied-Tenant', 'all-tenants');
    } else if (req.tenantId) {
      const t = String(req.tenantId);
      res.set('X-Applied-Tenant', t);
      res.set('X-Applied-Filter', JSON.stringify({
        $or: [
          { tenant_id: t },
          { organization_id: t },
          { organizationId: t },
        ]
      }));
    }
  } catch {}

  next();
});

router.get(
  '/',
  sessionsEarlyBypassDetector,
  asyncHandler(async (req, res) => {

    // --------------------------------------------------
    // FIXED: Single bypass variable, declared once
    // --------------------------------------------------
    const bypass = !!(
      req.tenantScopeDisabled ||
      req.allTenants ||
      req.sessionsAllTenantsBypass ||
      req?.user?.isSuperAdmin
    );

    // --------------------------------------------------
    // FIXED: Single enforcedTenant variable
    // --------------------------------------------------
    const enforcedTenant =
      req.tenantId ||
      (typeof req.query.tenant_id === 'string' && req.query.tenant_id.trim()) ||
      (typeof req.query.organization_id === 'string' && req.query.organization_id.trim()) ||
      (typeof req.headers['x-tenant-id'] === 'string' && req.headers['x-tenant-id'].trim()) ||
      (typeof req.headers['x-organization-id'] === 'string' && req.headers['x-organization-id'].trim()) ||
      null;

    // If not bypassing and no tenant provided → error
    if (!bypass && !enforcedTenant) {
      return res.status(400).json({
        success: false,
        message: 'tenant_id is required. Provide ?tenant_id=...'
      });
    }

    // --------------------------------------------------
    // Request logging
    // --------------------------------------------------
    try {
      res.set('X-Sessions-Bypass', String(bypass));
      const appliedTenant = bypass ? 'all-tenants' : enforcedTenant;
      res.set('X-Applied-Tenant', String(appliedTenant));
    } catch {}

    // Pagination
    const rawQuery = { ...req.query };
    if (rawQuery.pageSize && !rawQuery.limit) rawQuery.limit = rawQuery.pageSize;

    const { page, limit, skip, explicit } = parsePagination(rawQuery);
    const sort = req.query.sort || '-session_start';

    // --------------------------------------------------
    // Search filter
    // --------------------------------------------------
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

    // --------------------------------------------------
    // Filter parsing (tolerant)
    // --------------------------------------------------
    let filter = {};
    let filterSource = 'none';
    if (typeof req.query.filter !== 'undefined') {
      const raw = req.query.filter;
      if (typeof raw === 'object') {
        filter = raw || {};
        filterSource = 'object';
      } else if (typeof raw === 'string') {
        try {
          filter = JSON.parse(raw);
          filterSource = 'raw-json';
        } catch (e1) {
          try {
            const decoded = decodeURIComponent(raw);
            filter = JSON.parse(decoded);
            filterSource = 'url-encoded-json';
          } catch (e2) {
            console.warn('[session-tracking] filter parse failed; will fallback to time params', {
              error1: e1?.message, error2: e2?.message, raw
            });
            filter = {};
            filterSource = 'fallback-time';
          }
        }
      }
    }
    // remove tenant keys; enforce on server
    if (filter && typeof filter === 'object') {
      delete filter.tenant_id;
      delete filter.organization_id;
      delete filter.organizationId;
      if (Array.isArray(filter.$or)) delete filter.$or;
    }

    // --------------------------------------------------
    // FIXED: Single enforcedScope variable
    // --------------------------------------------------
    const enforcedScope = (!bypass && enforcedTenant)
      ? {
          $or: [
            { tenant_id: enforcedTenant },
            { organization_id: enforcedTenant },
            { organizationId: enforcedTenant },
          ],
        }
      : {};

    // --------------------------------------------------
    // Date filter (tolerant + from/to mapping)
    // session-tracking maps time filters to session_start/session_end fields
    // --------------------------------------------------
    let timeFilter = {};
    // Prefer explicit start/end if provided
    let startVal = req.query.start;
    let endVal = req.query.end;

    // Fallback to from/to if start/end not provided
    if (!startVal && typeof req.query.from === 'string') startVal = req.query.from;
    if (!endVal && typeof req.query.to === 'string') endVal = req.query.to;

    let start = null;
    let end = null;

    if (startVal && isValidISODate(startVal)) {
      start = parseISODateSafe(startVal);
    }
    if (endVal && isValidISODate(endVal)) {
      end = parseISODateSafe(endVal);
      // inclusive end-of-day
      end.setUTCHours(23, 59, 59, 999);
    }

    if (start || end) {
      if (start && !end) end = new Date();
      if (end && !start) start = new Date(0);
      timeFilter = { session_start: { $gte: start, $lte: end } };
      console.log('[session-tracking] timeFilter from params', {
        source: filterSource, start: start?.toISOString?.(), end: end?.toISOString?.()
      });
    }

    // --------------------------------------------------
    // Combine filters
    // --------------------------------------------------
    const parts = [];
    const isEmpty = (o) => !o || (typeof o === 'object' && Object.keys(o).length === 0);

    if (!isEmpty(filter)) parts.push(filter);
    if (!isEmpty(qFilter)) parts.push(qFilter);
    if (!isEmpty(enforcedScope)) parts.push(enforcedScope);
    if (!isEmpty(timeFilter)) parts.push(timeFilter);

    const finalFilter = parts.length > 1 ? { $and: parts } : (parts[0] || {});

    try {
      res.set('X-Parsed-Filter-Source', String(filterSource));
      console.log('[session-tracking] parsed filter', { filterSource, filterPreview: JSON.stringify(filter).slice(0, 500) });
    } catch {}

    // --------------------------------------------------
    // Execute
    // --------------------------------------------------
    try {
      if (explicit) {
        const [docs, total] = await Promise.all([
          SessionTracking.find(finalFilter).sort(sort).skip(skip).limit(limit),
          SessionTracking.countDocuments(finalFilter),
        ]);

        return res.json({
          success: true,
          data: docs,
          meta: { page, limit, total }
        });
      }

      const docs = await SessionTracking.find(finalFilter).sort(sort);
      return res.json(docs);

    } catch (err) {
      return res.status(400).json({
        success: false,
        message: 'Request failed',
        details: err?.message || ''
      });
    }
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
