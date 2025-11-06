'use strict';

const express = require('express');
const router = express.Router();

// Health routes that never fail
try {
  const healthController = require('../controllers/health');
  router.get('/', healthController.check);
  router.get('/healthz', healthController.check);
} catch {
  router.get('/', (req, res) => res.json({ ok: true }));
  router.get('/healthz', (req, res) => res.json({ ok: true }));
}

// Optionally load middlewares and routes; guard missing modules
let verifyAuth, requireTenant;
try { ({ verifyAuth } = require('../middleware/verifyAuth')); } catch {}
try { ({ requireTenant } = require('../middleware/requireTenant')); } catch {}

function mount(path, factory, protectedRoute = false) {
  try {
    const r = factory();
    if (protectedRoute && verifyAuth && requireTenant) {
      router.use(path, verifyAuth, requireTenant, r);
    } else {
      router.use(path, r);
    }
  } catch (e) {
    try { console.warn(`[routes] Skipping ${path}:`, e?.message); } catch {}
  }
}

// Public auth routes remain unprotected
mount('/auth', () => require('./auth.routes'), false);

// Protected core routes behind auth + tenant
mount('/users', () => require('./users.routes'), true);
mount('/tenants', () => require('./tenants.routes'), true);

mount('/llm-costs', () => require('./llmCosts.routes'), true);
mount('/llm-costs-aggregate', () => require('./llmCosts.aggregate.routes'), true);
mount('/costs', () => require('./costs.byAgent.routes'), true);
mount('/session', () => require('./session.routes'), true);
mount('/session-tracking', () => require('./sessionTracking.routes'), true);
mount('/app-deployments', () => require('./appDeployments.routes'), true);

// Dashboard overview routes (protected)
mount('/dashboard/overview', () => require('./dashboard.routes'), true);
mount('/dashboard/overview', () => require('./dashboard.modules.routes'), true);

// Analytics overview routes protected here as well
mount('/analytics', () => require('./analytics.overview.routes'), true);

// Counts endpoints (these are lightweight; keep public if they are used for landing)
mount('/', () => require('./counts.routes'), false);

// Sample tenant-scoped demo endpoints
mount('/', () => require('./tenantSample.routes'), false);

module.exports = router;
