const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant: requireTenantMw } = require('../middleware/requireTenant');
const { sessionTrackingScope } = require('../middleware/sessionTrackingScope');
const controller = buildCrudController(SessionTracking, '-session_start');

/**
 * Enforce JWT + Tenant + Session scope (tenant-only) at router level for ALL routes.
 * Using router.use ensures coverage for:
 *   GET '/', GET '/:id', POST '/', PUT '/:id', DELETE '/:id'
 */
router.use(verifyAuth, requireTenantMw, sessionTrackingScope);

/**
 * Dev-only: global response wrapper to assert and log tenant correctness for ALL /session-tracking routes.
 * - Logs unique tenant_ids found in response payloads.
 * - Warns if any returned document's tenant_id != req.auth.tenantId.
 */
if (process.env.NODE_ENV !== 'production') {
  router.use((req, res, next) => {
    try {
      // eslint-disable-next-line no-console
      console.debug(
        '[session-tracking.dev] tenantId:',
        req?.auth?.tenantId || null,
        'forcedFilter:',
        req?.forcedFilter || null
      );
    } catch {}
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
        if (Array.isArray(items)) {
          const tenants = Array.from(new Set(items.map((d) => d && d.tenant_id)));
          // eslint-disable-next-line no-console
          console.debug('[session-tracking.dev] response tenants:', tenants);
          const expected = String(req?.auth?.tenantId || '');
          const mismatches = items.filter((d) => d && String(d.tenant_id || '') !== expected).slice(0, 3);
          if (mismatches.length > 0) {
            // eslint-disable-next-line no-console
            console.warn('[session-tracking.dev][WARNING] Returned docs with mismatched tenant_id detected. expected=', expected);
          }
        } else if (body && typeof body === 'object' && body._id) {
          // Single doc case for getById/update/delete responses that return a doc
          const expected = String(req?.auth?.tenantId || '');
          const got = String(body.tenant_id || '');
          if (expected && got && got !== expected) {
            // eslint-disable-next-line no-console
            console.warn('[session-tracking.dev][WARNING] Single doc tenant_id mismatch. expected=', expected, 'got=', got);
          }
        }
      } catch {}
      return originalJson(body);
    };
    return next();
  });
}

/**
 * Writes: ensure body.tenant_id is forced to authenticated tenant before controller.
 * This prevents any client-provided tenant_id from being persisted.
 */
function forceTenantOnBody(req, _res, next) {
  try {
    if (req?.auth?.tenantId) {
      req.body = req.body && typeof req.body === 'object' ? { ...req.body } : {};
      req.body.tenant_id = String(req.auth.tenantId);
    }
  } catch {}
  return next();
}

// List and CRUD with strict scoping applied downstream by controller via req.forcedFilter
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    return controller.list(req, res, next);
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', forceTenantOnBody, asyncHandler(controller.create));
router.put('/:id', forceTenantOnBody, asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
