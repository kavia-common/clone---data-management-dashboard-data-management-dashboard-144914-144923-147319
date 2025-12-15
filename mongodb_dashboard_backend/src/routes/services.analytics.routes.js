'use strict';

const express = require('express');
const router = express.Router();

const { servicesSummaryHandler } = require('../controllers/servicesAnalytics.controller');
const { tenantScopeEnforcer } = require('../middleware/tenantScopeEnforcer') || {};
const { extractOrganization } = require('../middleware/extractOrganization') || {};

// Summary route similar to counts/users summary; keep middleware minimal to mirror overview endpoints.
// Note: tenantScopeEnforcer may enforce JWT tenant vs header/query consistency if available in codebase.
router.get('/api/services/summary', extractOrganization || ((req, _res, next) => next()), servicesSummaryHandler);

module.exports = router;
