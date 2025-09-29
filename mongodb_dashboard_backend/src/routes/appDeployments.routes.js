const express = require('express');
const { asyncHandler } = require('../utils/http');
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

router.get('/', asyncHandler(controller.list));
router.get('/:id', asyncHandler(controller.getById));
router.post('/', validateAppDeployment, asyncHandler(controller.create));
router.put('/:id', validateAppDeployment, asyncHandler(controller.update));
router.delete('/:id', asyncHandler(controller.remove));

module.exports = router;
