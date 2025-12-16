const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

/**
 * PUBLIC_INTERFACE
 * Users routes mounting
 * Summary sub-router is mounted BEFORE the main users router so that the static path
 * '/summary' resolves correctly and is not captured by the dynamic '/:id' route.
 * Do not remount '/api/users' elsewhere (e.g., in app.js) to preserve this order.
 */
// Mount the summary sub-router FIRST so /api/users/summary is matched before any dynamic '/:id'
const usersSummaryRoutes = require('./users.summary');
router.use('/users', usersSummaryRoutes);
// Mount the main users router AFTER summary so that '/:id' does not capture '/summary'
try {
  const usersRoutes = require('./users.routes');
  router.use('/users', usersRoutes);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[routes/index] users.routes not mounted due to error:', err?.message || err);
}

// Mount new LLM costs aggregation (underscore path) without touching existing /api/llm-costs routes
try {
  const llmCostsUnderscore = require('./llm_costs.routes');
  router.use('/llm_costs', llmCostsUnderscore);
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[routes/index] llm_costs.routes not mounted due to error:', err?.message || err);
}

/**
 * PUBLIC_INTERFACE
 * GET /
 * Basic service status for root path. Returns 200 OK with health summary and pointers
 * to documentation. This is intentionally lightweight and unauthenticated so that
 * curl / returns something useful in environments where the frontend or ops probes
 * may ping the root path.
 */
router.get('/', (req, res) => {
  const ready = mongoose.connection.readyState;
  const db = ready === 1 ? 'connected' : ready === 2 ? 'connecting' : 'disconnected';
  const payload = {
    success: true,
    status: 'ok',
    db,
    docs: '/api-docs',
    health: '/api/health',
    timestamp: new Date().toISOString(),
    message: 'Welcome to the Dashboard API. See /api-docs for the full OpenAPI.',
  };
  res.set('Cache-Control', 'no-store');
  return res.status(200).json(payload);
});

module.exports = router;
