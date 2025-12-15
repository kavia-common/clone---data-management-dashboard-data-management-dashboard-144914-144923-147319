'use strict';

const express = require('express');
const router = express.Router();

const { servicesSummaryHandler } = require('../controllers/servicesAnalytics.controller');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer') || {};
const { extractOrganization } = require('../middleware/extractOrganization') || {};

/**
 * When this router is mounted under the base router at '/api' (see src/app.js uses baseRouter at '/api'
 * and src/routes/index.js mounts this router at '/'), we must define relative paths here.
 * Using '/api/services/summary' here resulted in an effective '/api/api/services/summary' and a 404.
 *
 * Correct effective path: '/api/services/summary'
 * Therefore route here must be defined as '/services/summary'.
 */
router.get('/services/summary', extractOrganization || ((req, _res, next) => next()), servicesSummaryHandler);

module.exports = router;
