const express = require('express');
const { asyncHandler } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
const User = require('../models/user.model');
const { buildCrudController } = require('../controllers/crudFactory');

const router = express.Router();
const controller = buildCrudController(User, '-created_at');

/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Users collection endpoints (referrals)
 */

router.get('/', requireAuth, asyncHandler(controller.list));
router.get('/:id', requireAuth, asyncHandler(controller.getById));
router.post('/', requireAuth, asyncHandler(controller.create));
router.put('/:id', requireAuth, asyncHandler(controller.update));
router.delete('/:id', requireAuth, asyncHandler(controller.remove));

module.exports = router;
