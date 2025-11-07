'use strict';

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
const analyticsOverviewRoutes = require('./analytics.overview.routes');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Health endpoint for base router.
 * Returns 200 with { status: 'ok', db, timestamp, host, port }.
 * This is used by container readiness checks.
 */
router.get('/', healthController.check?.bind?.(healthController) || ((req, res) => res.status(200).json({ status: 'ok' })));
router.get('/healthz', healthController.check?.bind?.(healthController) || ((req, res) => res.status(200).json({ status: 'ok' })));

// Public auth routes remain unprotected
router.use('/auth', authRoutes);

/**
 * Users route manages its own Cognito/JWKS auth to ensure it returns only the authenticated user.
 * Keep verifyAuth+requireTenant here for general safety; the router overrides with stricter behavior internally.
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
router.use('/analytics', verifyAuth, requireTenant, analyticsOverviewRoutes);

// Counts endpoints (these are lightweight; keep public if they are used for landing)
router.use('/', countsRoutes);

// Sample tenant-scoped demo endpoints
router.use('/', require('./tenantSample.routes'));

module.exports = router;