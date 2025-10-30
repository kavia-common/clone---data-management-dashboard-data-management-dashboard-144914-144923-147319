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

// Users analytics routers (new additive endpoints from users collection)
const usersAnalyticsActivityRouter = require('./analytics.users.activity.routes');
const usersAnalyticsSummaryRouter = require('./analytics.users.summary.routes');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Health endpoint for base router
 */
router.get('/', healthController.check.bind(healthController));
router.get('/healthz', healthController.check.bind(healthController));

// Mount core API routes
router.use('/auth', authRoutes);
try { console.log('[routes] Mount /api/users base + analytics'); } catch {}
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
 * Users analytics routing
 * Canonical: /api/users/*
 * Single optional alias group: /api/analytics/users/*
 * Remove /api/users/analytics and avoid double-mounting under /users to prevent shadowing.
 */
router.use('/users', usersAnalyticsActivityRouter);
router.use('/users', usersAnalyticsSummaryRouter);

// Optional single alias group
router.use('/analytics/users', usersAnalyticsActivityRouter);
router.use('/analytics/users', usersAnalyticsSummaryRouter);

module.exports = router;
