'use strict';

const express = require('express');
const router = express.Router();
const { auditLoggerMiddleware } = require('../middleware/standardHandlers');
const { getGroupByAgents, getGroupByTeams, getUsageByUser, getFeaturesByCredit } = require('../controllers/analyticsUsage.controller');

// Apply audit logger to these analytics routes
router.use(auditLoggerMiddleware);

// GET /api/analytics/group-by-agents
router.get('/group-by-agents', getGroupByAgents);

// GET /api/analytics/group-by-teams
router.get('/group-by-teams', getGroupByTeams);

// GET /api/analytics/usage-by-user
router.get('/usage-by-user', getUsageByUser);

// GET /api/analytics/features-by-credit
router.get('/features-by-credit', getFeaturesByCredit);

module.exports = router;
