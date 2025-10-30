'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/users.insights.controller');

/**
 * Users Insights Analytics Routes (v3)
 *
 * Summary and trend endpoints for user activity.
 * Responses include items and meta suitable for visualization.
 */

router.get('/api/users/activity', ctrl.activity);
router.get('/api/users/trends', ctrl.trends);
router.get('/api/users/organizations', ctrl.organizations);
router.get('/api/users/departments', ctrl.departments);
router.get('/api/users/compliance', ctrl.compliance);
router.get('/api/users/engagement-trend', ctrl.engagementTrend);
router.get('/api/users/kpis', ctrl.kpis);

module.exports = router;
