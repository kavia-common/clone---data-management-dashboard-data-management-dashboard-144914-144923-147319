'use strict';

const express = require('express');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');
const { tryRequireRoute } = require('../utils/app');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Minimal root endpoint indicating service is running.
 */
router.get('/', (req, res) => {
  return res.status(200).json({ status: 'ok', message: 'Dashboard API backend' });
});

// Public auth routes remain unprotected
router.use('/auth', tryRequireRoute('./auth.routes', { mountPath: '/api/auth', label: 'auth.routes' }));

// Protected core routes behind auth + tenant
router.use('/users', verifyAuth, requireTenant, tryRequireRoute('./users.routes', { mountPath: '/api/users', label: 'users.routes' }));
router.use('/tenants', verifyAuth, requireTenant, tryRequireRoute('./tenants.routes', { mountPath: '/api/tenants', label: 'tenants.routes' }));

router.use('/llm-costs', verifyAuth, requireTenant, tryRequireRoute('./llmCosts.routes', { mountPath: '/api/llm-costs', label: 'llmCosts.routes' }));
router.use('/llm-costs-aggregate', verifyAuth, requireTenant, tryRequireRoute('./llmCosts.aggregate.routes', { mountPath: '/api/llm-costs-aggregate', label: 'llmCosts.aggregate.routes' }));
router.use('/costs', verifyAuth, requireTenant, tryRequireRoute('./costs.byAgent.routes', { mountPath: '/api/costs', label: 'costs.byAgent.routes' }));
router.use('/session', verifyAuth, requireTenant, tryRequireRoute('./session.routes', { mountPath: '/api/session', label: 'session.routes' }));
router.use('/session-tracking', verifyAuth, requireTenant, tryRequireRoute('./sessionTracking.routes', { mountPath: '/api/session-tracking', label: 'sessionTracking.routes' }));
router.use('/app-deployments', verifyAuth, requireTenant, tryRequireRoute('./appDeployments.routes', { mountPath: '/api/app-deployments', label: 'appDeployments.routes' }));

// Dashboard overview routes (protected)
router.use('/dashboard/overview', verifyAuth, requireTenant, tryRequireRoute('./dashboard.routes', { mountPath: '/api/dashboard/overview', label: 'dashboard.routes' }));
router.use('/dashboard/overview', verifyAuth, requireTenant, tryRequireRoute('./dashboard.modules.routes', { mountPath: '/api/dashboard/overview', label: 'dashboard.modules.routes' }));

/**
 * Analytics overview routes protected here as well
 * This guarantees verifyAuth + requireTenant are always enforced.
 */
router.use('/analytics', verifyAuth, requireTenant, tryRequireRoute('./analytics.overview.routes', { mountPath: '/api/analytics', label: 'analytics.overview.routes' }));

// Counts endpoints (these are lightweight; keep public if they are used for landing)
router.use('/', tryRequireRoute('./counts.routes', { mountPath: '/', label: 'counts.routes' }));

// Sample tenant-scoped demo endpoints
router.use('/', tryRequireRoute('./tenantSample.routes', { mountPath: '/', label: 'tenantSample.routes' }, buildStubRouter('Sample routes unavailable')));

module.exports = router;