const express = require('express');
const { asyncHandler } = require('../utils/http');
const { buildCrudController } = require('../controllers/crudFactory');
const LLMCost = require('../models/llmCosts.model');

const router = express.Router();
// Default sort by most recent cost first
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant: requireTenantMw } = require('../middleware/requireTenant');
const controller = buildCrudController(LLMCost, '-timestamp');

// Enforce JWT + Tenant at router level
router.use(verifyAuth, requireTenantMw, require('../middleware/tenantScope').tenantScope());

/**
 * @swagger
 * tags:
 *   name: LLMCosts
 *   description: LLM usage cost records endpoints
 */

// List
router.get('/', asyncHandler(controller.list));
// Get by id
router.get('/:id', asyncHandler(controller.getById));
// Create
router.post('/', asyncHandler(controller.create));
// Update
router.put('/:id', asyncHandler(controller.update));
// Delete
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
