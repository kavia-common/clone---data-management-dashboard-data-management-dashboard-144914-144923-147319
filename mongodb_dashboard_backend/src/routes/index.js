'use strict';

const express = require('express');
const router = express.Router();

// Health endpoints without importing external controllers to avoid startup crashes
// PUBLIC_INTERFACE
router.get('/', (req, res) =>
  res.status(200).json({ ready: true, status: 'ok', source: 'base-router' })
);
router.get('/health', (req, res) =>
  res.status(200).json({ ready: true, status: 'ok', source: 'base-router' })
);
router.get('/healthz', (req, res) =>
  res.status(200).json({ ready: true, status: 'ok', source: 'base-router' })
);

// Helper to safely mount optional modules
const safeMount = (path, loader) => {
  try {
    const r = loader();
    router.use(path, r);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[routes/index] Skipping mount ${path}:`, e?.message || e);
  }
};

// Mount core API routes guarded
safeMount('/auth', () => require('./auth.routes'));
safeMount('/users', () => require('./users.routes'));
safeMount('/tenants', () => require('./tenants.routes'));
safeMount('/data', () => require('./data.routes'));
safeMount('/llm-costs', () => require('./llmCosts.routes'));
safeMount('/llm-costs-aggregate', () => require('./llmCosts.aggregate.routes'));
safeMount('/costs', () => require('./costs.byAgent.routes'));
safeMount('/session', () => require('./session.routes'));
safeMount('/session-tracking', () => require('./sessionTracking.routes'));
safeMount('/app-deployments', () => require('./appDeployments.routes'));

// Dashboard overview routes
safeMount('/dashboard/overview', () => require('./dashboard.routes'));
safeMount('/dashboard/overview', () => require('./dashboard.modules.routes'));

// Analytics routes
safeMount('/analytics', () => require('./analytics.routes'));
safeMount('/analytics', () => require('./featureUsage.routes'));

// Counts endpoints at top-level /api
safeMount('/', () => require('./counts.routes'));

module.exports = router;
