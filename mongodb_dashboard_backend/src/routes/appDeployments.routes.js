const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
const AppDeployment = require('../models/appDeployments.model');
const { buildCrudController } = require('../controllers/crudFactory');
const { validateAppDeployment } = require('../middleware/validators');

const router = express.Router();
const controller = buildCrudController(AppDeployment, '-created_at');

/**
 * @swagger
 * tags:
 *   name: AppDeployments
 *   description: Application deployments endpoints
 */

router.get('/', requireAuth, asyncHandler(controller.list));
router.get('/:id', requireAuth, asyncHandler(controller.getById));
router.post('/', requireAuth, validateAppDeployment, asyncHandler(controller.create));
router.put('/:id', requireAuth, validateAppDeployment, asyncHandler(controller.update));
router.delete('/:id', requireAuth, asyncHandler(controller.remove));

module.exports = router;
