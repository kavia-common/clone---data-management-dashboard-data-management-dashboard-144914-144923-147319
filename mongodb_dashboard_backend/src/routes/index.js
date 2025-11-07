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
router.use('/users', verifyAuth, requireTenant, require('./users.routes'));
router.use('/tenants', verifyAuth, requireTenant, require('./tenants.routes'));

router.use('/llm-costs', verifyAuth, requireTenant, require('./llmCosts.routes'));
router.use('/llm-costs-aggregate', verifyAuth, requireTenant, require('./llmCosts.aggregate.routes'));
router.use('/costs', verifyAuth, requireTenant, require('./costs.byAgent.routes'));
router.use('/session', verifyAuth, requireTenant, require('./session.routes'));
router.use('/session-tracking', verifyAuth, requireTenant, require('./sessionTracking.routes'));
router.use('/app-deployments', verifyAuth, requireTenant, require('./appDeployments.routes'));

// Dashboard overview routes (protected)
router.use('/dashboard/overview', verifyAuth, requireTenant, require('./dashboard.routes'));
router.use('/dashboard/overview', verifyAuth, requireTenant, require('./dashboard.modules.routes'));

/**
 * Analytics overview routes protected here as well
 */
router.use('/analytics', verifyAuth, requireTenant, require('./analytics.overview.routes'));

module.exports = router;
