const express = require('express');
const healthController = require('../controllers/health');

// Import route modules
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const tenantsRoutes = require('./tenants.routes');
const dataRoutes = require('./data.routes');
const analyticsRoutes = require('./analytics.routes');
const llmCostsRoutes = require('./llmCosts.routes');
const llmCostsAggregateRoutes = require('./llmCosts.aggregate.routes');
const costsByAgentRoutes = require('./costs.byAgent.routes');
const sessionTrackingRoutes = require('./sessionTracking.routes');
const sessionRoutes = require('./session.routes');
const appDeploymentsRoutes = require('./appDeployments.routes');
const dashboardRoutes = require('./dashboard.routes');
const dashboardModulesRoutes = require('./dashboard.modules.routes');
const countsRoutes = require('./counts.routes');
const usersAnalyticsMetricsRoutes = require('./users.analytics.metrics.routes');

const router = express.Router();

/**
 * @swagger
 * /:
 *   get:
 *     summary: Health endpoint
 *     description: Returns health status of the service.
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service health check passed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: Service is healthy
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: string
 *                   example: development
 */
router.get('/', healthController.check.bind(healthController));
// Readiness/liveness alias commonly used by orchestrators
router.get('/healthz', healthController.check.bind(healthController));

// Mount API routes
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/tenants', tenantsRoutes);
router.use('/data', dataRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/llm-costs', llmCostsRoutes);
router.use('/llm-costs-aggregate', llmCostsAggregateRoutes);
router.use('/costs', costsByAgentRoutes);
router.use('/session', sessionRoutes);
router.use('/session-tracking', sessionTrackingRoutes);
router.use('/app-deployments', appDeploymentsRoutes);

// Dashboard overview routes
router.use('/dashboard/overview', dashboardRoutes);
router.use('/dashboard/overview', dashboardModulesRoutes);

/**
 * Users analytics (DAU/WAU/MAU and insights)
 * Mounted under /api/users/analytics
 */
router.use('/users/analytics', usersAnalyticsMetricsRoutes);

// Counts endpoints mounted at top-level /api
router.use('/', countsRoutes);

module.exports = router;
