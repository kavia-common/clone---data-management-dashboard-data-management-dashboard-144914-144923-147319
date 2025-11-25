'use strict';

const express = require('express');
const router = express.Router();
const controller = require('../controllers/analytics.overview.controller');
const { tenantScope } = require('../middleware/tenantScope');

// PUBLIC_INTERFACE
// GET /api/overview/sessions-trend
router.get('/sessions-trend', tenantScope, controller.getSessionsTrend);

// PUBLIC_INTERFACE
// GET /api/overview/users-trend
router.get('/users-trend', tenantScope, controller.getUsersTrend);

// PUBLIC_INTERFACE
// GET /api/overview/costs-trend
router.get('/costs-trend', tenantScope, controller.getCostsTrend);

// Backward compatible ping
router.get('/ping', (req, res) => res.json({ ok: true }));

module.exports = router;
