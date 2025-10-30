'use strict';

const express = require('express');
const healthController = require('../controllers/health');

// Core route modules
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const tenantsRoutes = require('./tenants.routes');
const dataRoutes = require('./data.routes');
const llmCostsRoutes = require('./llmCosts.routes');
const llmCostsAggregateRoutes = require('./llmCosts.aggregate.routes');
const costsByAgentRoutes = require('./costs.byAgent.routes');
const sessionTrackingRoutes = require('./sessionTracking.routes');
const sessionRoutes = require('./session.routes');
const appDeploymentsRoutes = require('./appDeployments.routes');
const dashboardRoutes = require('./dashboard.routes');
const dashboardModulesRoutes = require('./dashboard.modules.routes');
const countsRoutes = require('./counts.routes');

/**
 * Users analytics router mounted at /api/analytics/users
 * Ensures no 404 for frontend analyticsUsers client.
 */
const usersAnalyticsRouter = require('./analytics.users.activity.routes');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Health endpoint for base router
 */
router.get('/', healthController.check.bind(healthController));
router.get('/healthz', healthController.check.bind(healthController));

// Mount core API routes (analysis routes removed)
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/tenants', tenantsRoutes);
router.use('/data', dataRoutes);
router.use('/llm-costs', llmCostsRoutes);
router.use('/llm-costs-aggregate', llmCostsAggregateRoutes);
router.use('/costs', costsByAgentRoutes);
router.use('/session', sessionRoutes);
router.use('/session-tracking', sessionTrackingRoutes);
router.use('/app-deployments', appDeploymentsRoutes);

// Dashboard overview routes
router.use('/dashboard/overview', dashboardRoutes);
router.use('/dashboard/overview', dashboardModulesRoutes);

// Counts endpoints mounted at top-level /api
router.use('/', countsRoutes);

/**
 * Canonical analytics users endpoints
 */
router.use('/analytics/users', usersAnalyticsRouter);
/**
 * Compatibility alias so both /api/analytics/users/* and /api/users/analytics/* work.
 * This helps avoid frontend path mismatch issues without changing UI components.
 */
router.use('/users/analytics', usersAnalyticsRouter);

module.exports = router;
