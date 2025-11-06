const express = require('express');
const { asyncHandler } = require('../utils/http');
const { parsePagination } = require('../utils/http');
const SessionTracking = require('../models/sessionTracking.model');
const { buildTenantCrudController } = require('../controllers/crudFactory.tenant');

const router = express.Router();
const { verifyAuth } = require('../middleware');
const { requireTenant: requireTenantMw } = require('../middleware/requireTenant');
const controller = buildTenantCrudController(SessionTracking, '-session_start');

// Enforce JWT + Tenant at router level
router.use(verifyAuth, requireTenantMw);

// Simple list with tenant enforced by controller
router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', asyncHandler(controller.create));
router.put('/:id', asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
