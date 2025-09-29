const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
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

router.get('/', requireAuth, asyncHandler(controller.list));
router.get('/:id', requireAuth, asyncHandler(controller.getById));
router.post('/', requireAuth, asyncHandler(controller.create));
router.put('/:id', requireAuth, asyncHandler(controller.update));
router.delete('/:id', requireAuth, asyncHandler(controller.remove));

module.exports = router;
