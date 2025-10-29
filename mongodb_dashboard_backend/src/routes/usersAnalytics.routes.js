'use strict';

const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/usersAnalytics.controller');

/**
 * Note: Legacy aliases moved under /legacy to avoid overlapping with primary analytics metrics routes.
 * This prevents conflicts when both routers are mounted at /api/users/analytics.
 */
router.get('/legacy/overview', ctrl.overview);
router.get('/legacy/daily-active', ctrl.dailyActive);
router.get('/legacy/by-department', ctrl.byDepartment);
router.get('/legacy/active-vs-inactive', ctrl.activeVsInactive);
router.get('/legacy/top-active', ctrl.topActive);
router.get('/legacy/growth', ctrl.growth);

module.exports = router;
