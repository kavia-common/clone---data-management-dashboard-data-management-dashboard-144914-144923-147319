'use strict';

const express = require('express');
const router = express.Router();

// Keep existing mounts
router.use('/analytics', require('./analytics'));
router.use('/analytics/overview', require('./analytics.overview.routes'));

// New direct overview mount as per acceptance criteria
router.use('/overview', require('./analytics.overview.routes'));

router.use('/analytics/agents', require('./analyticsAgents'));
router.use('/counts', require('./counts.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/dev', require('./dev.routes'));
router.use('/llm-costs', require('./llmCosts.routes'));
router.use('/llm-costs-aggregate', require('./llmCosts.aggregate.routes'));
router.use('/llm-costs-hierarchy', require('./llmCosts.hierarchy.routes'));
router.use('/llm-costs-public', require('./llmCosts.public.routes'));
router.use('/projects', require('./projects.routes'));
router.use('/session', require('./session.routes'));
router.use('/session-tracking', require('./sessionTracking.routes'));
router.use('/tenants', require('./tenants.routes'));
router.use('/users', require('./users.routes'));
router.use('/users-analytics', require('./usersAnalytics.controller'));
router.use('/users/analytics', require('./users.analytics.controller'));
router.use('/users/analytics/summary', require('./users.analytics.summary.routes'));
router.use('/app-deployments', require('./appDeployments.routes'));

module.exports = router;
