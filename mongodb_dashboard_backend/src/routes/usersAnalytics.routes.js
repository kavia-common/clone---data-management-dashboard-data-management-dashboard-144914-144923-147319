'use strict';

const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/usersAnalytics.controller');

// Summary KPIs
router.get('/overview', ctrl.overview);

// Daily active users
router.get('/daily-active', ctrl.dailyActive);

// By department activity
router.get('/by-department', ctrl.byDepartment);

// Active vs inactive
router.get('/active-vs-inactive', ctrl.activeVsInactive);

// Top active users
router.get('/top-active', ctrl.topActive);

// Growth (new users trend)
router.get('/growth', ctrl.growth);

module.exports = router;
