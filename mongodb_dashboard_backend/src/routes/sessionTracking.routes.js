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

// Enforce JWT + Tenant + Session scope (tenant+user) at router level
router.use(verifyAuth, requireTenantMw, sessionTrackingScope);

// List and CRUD with strict scoping applied downstream by controller via req.forcedFilter
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
