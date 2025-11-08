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
 * Enforce JWT + Tenant + Session scope (tenant+user) at router level for ALL routes.
 * Using router.use ensures coverage for:
 *   GET '/', GET '/:id', POST '/', PUT '/:id', DELETE '/:id'
 */
router.use(verifyAuth, requireTenantMw, sessionTrackingScope);

// Dev-only: targeted assertion/log for computed tenant and final filter on list endpoint
if (process.env.NODE_ENV !== 'production') {
  router.use((req, _res, next) => {
    try {
      // eslint-disable-next-line no-console
      console.debug(
        '[session-tracking.dev] tenantId:',
        req?.auth?.tenantId || null,
        'forcedFilter:',
        req?.forcedFilter || null
      );
    } catch {}
    return next();
  });
}

// List and CRUD with strict scoping applied downstream by controller via req.forcedFilter
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    // Wrap list to add post-response dev verification log
    if (process.env.NODE_ENV !== 'production') {
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        try {
          const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
          const tenants = Array.isArray(items) ? Array.from(new Set(items.map((d) => d && d.tenant_id))) : [];
          // eslint-disable-next-line no-console
          console.debug('[session-tracking.dev] response tenants:', tenants);
        } catch {}
        return originalJson(body);
      };
    }
    return controller.list(req, res, next);
  })
);

router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
