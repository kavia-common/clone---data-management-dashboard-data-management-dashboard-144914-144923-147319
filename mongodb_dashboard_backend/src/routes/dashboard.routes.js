'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/http');
const controller = require('../controllers/analytics.overview.controller');
const { verifyAuth } = require('../middleware'); // unify export source
const { requireTenant } = require('../middleware/requireTenant');

const router = express.Router();

// Protect all dashboard overview routes
router.use(verifyAuth, requireTenant);

/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Dashboard overview endpoints
 */

// PUBLIC_INTERFACE
router.get('/metrics', asyncHandler(controller.overviewMetrics));

module.exports = router;
