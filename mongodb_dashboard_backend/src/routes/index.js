'use strict';

const express = require('express');
const healthController = require('../controllers/health');
const { verifyAuth } = require('../middleware/verifyAuth');
const { requireTenant } = require('../middleware/requireTenant');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Health endpoint for base router
 */
router.get('/', healthController.check?.bind?.(healthController) || ((req, res) => res.json({ ok: true })));
router.get('/healthz', healthController.check?.bind?.(healthController) || ((req, res) => res.json({ ok: true })));

// Public auth routes remain unprotected
router.use('/auth', require('./auth.routes'));

// Counts and sample routes are public to support landing/overview
router.use('/', require('./counts.routes'));
router.use('/', require('./tenantSample.routes'));

// Protected core routes behind auth + tenant (imports deferred until used)
router.use('/users', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./users.routes'));
const { ensureTenantAccess } = require('../middleware/authTenant');
router.use('/tenants', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), ensureTenantAccess, require('./tenants.routes'));

router.use('/llm-costs', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./llmCosts.routes'));
router.use('/llm-costs-aggregate', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./llmCosts.aggregate.routes'));
router.use('/costs', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./costs.byAgent.routes'));
router.use('/session', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./session.routes'));
router.use('/session-tracking', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./sessionTracking.routes'));
router.use('/app-deployments', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./appDeployments.routes'));

// Dashboard overview routes (protected)
router.use('/dashboard/overview', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./dashboard.routes'));
router.use('/dashboard/overview', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./dashboard.modules.routes'));

/**
 * Analytics overview routes protected here as well
 */
router.use('/analytics', verifyAuth, requireTenant, require('../middleware/tenantScope').tenantScope(), require('./analytics.overview.routes'));

module.exports = router;
