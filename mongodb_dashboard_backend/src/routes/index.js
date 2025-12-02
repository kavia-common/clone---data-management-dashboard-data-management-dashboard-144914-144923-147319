const express = require('express');
const healthController = require('../controllers/health');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

// Core route modules
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const tenantsRoutes = require('./tenants.routes');

const llmCostsRoutes = require('./llmCosts.routes');
const llmCostsAggregateRoutes = require('./llmCosts.aggregate.routes');
const costsByAgentRoutes = require('./costs.byAgent.routes');
const sessionTrackingRoutes = require('./sessionTracking.routes');
const sessionRoutes = require('./session.routes');
const appDeploymentsRoutes = require('./appDeployments.routes');
const dashboardRoutes = require('./dashboard.routes');
const dashboardModulesRoutes = require('./dashboard.modules.routes');
const countsRoutes = require('./counts.routes');
const { analyticsOverviewRouter } = require('./analytics.overview.routes');

const router = express.Router();

// Mount development verification routes only when not in production
if (process.env.NODE_ENV !== 'production') {
  router.use('/dev', require('./dev.verify.routes'));
}

/**
 * PUBLIC_INTERFACE
 * GET /
 * Health endpoint for base router
 */
router.get('/', (req, res) => {
  // Simple root health ping for uptime checks
  return res.status(200).json({ status: 'ok', message: 'Dashboard API backend' });
});
router.get('/healthz', healthController.check.bind(healthController));
router.get('/health', healthController.check.bind(healthController));

// Public auth routes remain unprotected
router.use('/auth', authRoutes);

/**
 * Protected core routes behind auth + tenant
 * Note: Super Admins (req.user.isSuperAdmin or T0000) are allowed to bypass tenant scoping by requireTenant/verifyAuth.
 */
router.use('/users', verifyAuth, requireTenant, usersRoutes);
router.use('/tenants', verifyAuth, requireTenant, tenantsRoutes);

router.use('/llm-costs', verifyAuth, requireTenant, llmCostsRoutes);
router.use('/llm-costs-aggregate', verifyAuth, requireTenant, llmCostsAggregateRoutes);
router.use('/costs', verifyAuth, requireTenant, costsByAgentRoutes);
router.use('/session', verifyAuth, requireTenant, sessionRoutes);
router.use('/session-tracking', verifyAuth, requireTenant, sessionTrackingRoutes);
router.use('/app-deployments', verifyAuth, requireTenant, appDeploymentsRoutes);

// Dashboard overview routes (protected)
router.use('/dashboard/overview', verifyAuth, requireTenant, dashboardRoutes);
router.use('/dashboard/overview', verifyAuth, requireTenant, dashboardModulesRoutes);

/**
 * Analytics overview routes protected here as well
 * This guarantees verifyAuth + requireTenant are always enforced.
 */
router.use('/analytics', verifyAuth, requireTenant, analyticsOverviewRouter);

/**
 * Counts endpoints (these are lightweight; keep public if they are used for landing)
 * Keep these last so more specific routes above take precedence.
 */
router.use('/', countsRoutes);

// Sample tenant-scoped demo endpoints
// No a11y attributes here; a11y for backend is via OpenAPI docs and headers only.
router.use('/', require('./tenantSample.routes'));

// PUBLIC_INTERFACE
/**
 * Exports the API router for mounting under /api in the main app.
 */
module.exports = router;
