'use strict';

const express = require('express');
const { verifyAuth } = require('../middleware');
const { requireTenant } = require('../middleware/requireTenant');

const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * GET /
 * Basic health/root endpoint
 */
router.get('/', (req, res) => res.json({ ok: true }));

/**
 * PUBLIC_INTERFACE
 * GET /health
 * Minimal readiness probe (no DB access)
 */
router.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

router.get('/healthz', (req, res) => res.json({ ok: true }));

// Public auth routes
try {
  router.use('/auth', require('./auth.routes'));
} catch { /* ignore if missing */ }

/**
 * PUBLIC_INTERFACE
 * GET /me
 * Protected identity probe to validate JWT and tenant extraction.
 */
router.get('/me', verifyAuth, requireTenant, (req, res) => {
  return res.status(200).json({
    tenant_id: req?.auth?.tenantId || null,
    sub: req?.auth?.sub || null,
    roles: req?.auth?.roles || [],
  });
});

// Protected core routes behind auth + tenant - only those that exist
const safeUse = (path, file) => {
  try {
    router.use(path, verifyAuth, requireTenant, require(file));
  } catch {
    // silently skip missing modules
  }
};

safeUse('/users', './users.routes');
safeUse('/tenants', './tenants.routes');
safeUse('/llm-costs', './llmCosts.routes');
safeUse('/session-tracking', './sessionTracking.routes');
safeUse('/session', './session.routes');
safeUse('/app-deployments', './appDeployments.routes');
safeUse('/analytics', './analytics.overview.routes');

module.exports = router;
